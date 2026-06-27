/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

import type { TextOverlay, BoundingBox, TextType, BubbleShape } from '@/types/translation';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { VERTICAL_TEXT_RATIO_THRESHOLD } from '../constants';

// ── Gemini Response Types ────────────────────────────────────────────

interface GeminiBubble {
  originalText: string;
  translatedText: string;
  bbox: {
    ymin: number;
    xmin: number;
    ymax: number;
    xmax: number;
  };
  textType: string;
  isVertical: boolean;
  bubbleShape: string;
}

interface GeminiResponse {
  bubbles: GeminiBubble[];
}

// ── API Key Helpers ──────────────────────────────────────────────────

export function getApiKey(): string | undefined {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }
  
  try {
    const dotenvPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(dotenvPath)) {
      const content = fs.readFileSync(dotenvPath, 'utf-8');
      const match = content.match(/GEMINI_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/);
      if (match && match[1]) {
        console.log('[Gemini] Loaded API key dynamically from .env.local');
        return match[1];
      }
    }
  } catch (e) {
    console.error('[Gemini] Failed to read .env.local manually:', e);
  }
  
  return undefined;
}

export const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-2.5-pro',
  'gemini-1.5-pro',
  'gemini-3.1-flash-lite'
];

let lastActiveGeminiModelIndex = 0;
let lastActiveOpenRouterModelIndex = 0;

const CACHE_DIR = path.join(process.cwd(), '.cache');
const STATE_FILE = path.join(CACHE_DIR, 'model_state.json');

function loadModelState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      if (typeof data.geminiIndex === 'number' && data.geminiIndex >= 0 && data.geminiIndex < GEMINI_MODELS.length) {
        lastActiveGeminiModelIndex = data.geminiIndex;
      }
      if (typeof data.openRouterIndex === 'number' && data.openRouterIndex >= 0 && data.openRouterIndex < OPENROUTER_MODELS.length) {
        lastActiveOpenRouterModelIndex = data.openRouterIndex;
      }
      console.log(`[Gemini/OpenRouter] Restored active model indices: Gemini=${lastActiveGeminiModelIndex}, OpenRouter=${lastActiveOpenRouterModelIndex}`);
    }
  } catch (e) {
    console.error('[Gemini] Failed to load model state from disk:', e);
  }
}

function saveModelState() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      geminiIndex: lastActiveGeminiModelIndex,
      openRouterIndex: lastActiveOpenRouterModelIndex
    }, null, 2));
  } catch (e) {
    console.error('[Gemini] Failed to save model state to disk:', e);
  }
}

// Initialize state
loadModelState();

export async function tryGeminiModels<T>(
  apiKey: string,
  executeFn: (model: any) => Promise<T>
): Promise<T> {
  const genAI = new GoogleGenerativeAI(apiKey);
  let lastError: any = null;
  const startIndex = lastActiveGeminiModelIndex;

  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    const idx = (startIndex + i) % GEMINI_MODELS.length;
    const modelName = GEMINI_MODELS[idx];
    try {
      console.log(`[Gemini] Attempting call with model: ${modelName} (index: ${idx})...`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await executeFn(model);
      
      if (lastActiveGeminiModelIndex !== idx) {
        console.log(`[Gemini] Switching last active model to: ${idx} (${modelName})`);
        lastActiveGeminiModelIndex = idx;
        saveModelState();
      }
      
      console.log(`[Gemini] Success using model: ${modelName}`);
      return result;
    } catch (err: any) {
      console.warn(`[Gemini] Model ${modelName} failed or quota exceeded:`, err.message || err);
      lastError = err;
      if (err.message && (err.message.includes('API key not valid') || err.message.includes('key is invalid'))) {
        throw err;
      }
    }
  }

  throw new Error(`All Gemini models failed. Last error: ${lastError?.message || lastError}`);
}

export function getOpenRouterKey(): string | undefined {
  if (process.env.OPENROUTER_API_KEY) {
    return process.env.OPENROUTER_API_KEY;
  }
  
  try {
    const dotenvPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(dotenvPath)) {
      const content = fs.readFileSync(dotenvPath, 'utf-8');
      const match = content.match(/OPENROUTER_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/);
      if (match && match[1]) {
        console.log('[OpenRouter] Loaded API key dynamically from .env.local');
        return match[1];
      }
    }
  } catch (e) {
    console.error('[OpenRouter] Failed to read .env.local manually:', e);
  }
  
  return undefined;
}

export const OPENROUTER_MODELS = [
  'google/gemini-2.5-flash',
  'google/gemini-2.5-pro',
  'openrouter/free'
];

export async function tryOpenRouterModels(
  apiKey: string,
  messages: any[],
  jsonMode: boolean = false,
  maxTokens: number = 3000
): Promise<string> {
  let lastError: any = null;
  const startIndex = lastActiveOpenRouterModelIndex;

  for (let i = 0; i < OPENROUTER_MODELS.length; i++) {
    const idx = (startIndex + i) % OPENROUTER_MODELS.length;
    const modelName = OPENROUTER_MODELS[idx];
    try {
      console.log(`[OpenRouter] Attempting call with model: ${modelName} (index: ${idx})...`);
      const headers: Record<string, string> = {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Manga Translator"
      };

      const body: any = {
        model: modelName,
        messages,
        max_tokens: maxTokens
      };

      if (jsonMode) {
        body.response_format = { type: "json_object" };
      }

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error("OpenRouter returned empty response content");
      }

      if (lastActiveOpenRouterModelIndex !== idx) {
        console.log(`[OpenRouter] Switching last active model to: ${idx} (${modelName})`);
        lastActiveOpenRouterModelIndex = idx;
        saveModelState();
      }


      console.log(`[OpenRouter] Success using model: ${modelName}`);
      return text;
    } catch (err: any) {
      console.warn(`[OpenRouter] Model ${modelName} failed or quota exceeded:`, err.message || err);
      lastError = err;
    }
  }

  throw new Error(`All OpenRouter models failed. Last error: ${lastError?.message || lastError}`);
}


// ── Enhanced Gemini Vision Prompt ────────────────────────────────────

const VISION_PROMPT = `You are an expert manga/manhwa/webtoon analyzer and translator. Analyze this page image and find every text element.

For each text element detected, return:
1. **originalText**: The exact original text.
2. **translatedText**: Natural, fluent manga-style Arabic translation.
3. **bbox**: Bounding box of the INNER AREA of the text region (inside bubble borders).
   Format: ymin, xmin, ymax, xmax — normalized to 0–1000 scale.
   - For speech bubbles: bbox covers the inside of the bubble, EXCLUDING the black outline/border.
   - For text on artwork: tight bounding box around the text lines.
4. **textType**: Classify each text element as one of:
   - "speech_bubble" — dialogue inside a speech bubble
   - "narration_box" — narrator text in a rectangular box
   - "sfx" — sound effects (onomatopoeia like BOOM, ドドド, 쾅)
   - "watermark" — scanlation credits, URLs, translator notes
   - "chapter_title" — chapter number or title text
   - "decorative" — decorative/artistic text that is part of the artwork
5. **isVertical**: true if the text is written vertically (common in Japanese manga), false otherwise.
6. **bubbleShape**: The shape of the containing bubble:
   - "ellipse" — oval/circular speech bubble
   - "rectangle" — rectangular narrator box or panel
   - "cloud" — thought/cloud bubble with wavy edges
   - "irregular" — any other shape or no clear bubble

RULES:
- Translate ONLY speech_bubble and narration_box types to Arabic.
- For sfx: include originalText but set translatedText to the Arabic phonetic equivalent if possible, otherwise keep original.
- For watermark, chapter_title, decorative: include originalText but set translatedText to empty string "".
- bbox must stay INSIDE bubble borders — never include the outline itself.
- ymin = top edge, ymax = bottom edge, xmin = left edge, xmax = right edge.
- Detect ALL text elements, even those without speech bubble borders.
- EXCLUDE: purely decorative background patterns that aren't actual text.`;

// ── Main Entry Point ─────────────────────────────────────────────────

export async function translateImageWithGemini(
  imageBuffer: Buffer,
  mimeType: string,
  imageWidth: number,
  imageHeight: number
): Promise<TextOverlay[] | null> {
  const apiKey = getApiKey();
  const openRouterKey = getOpenRouterKey();
  if (!apiKey && !openRouterKey) {
    console.log('[Gemini/OpenRouter] Neither GEMINI_API_KEY nor OPENROUTER_API_KEY is configured. Skipping.');
    return null;
  }

  const MAX_SLICE_HEIGHT = 1600;
  if (imageHeight > MAX_SLICE_HEIGHT) {
    const sliceHeight = 1200;
    const overlap = 150;
    const step = sliceHeight - overlap;

    console.log(`[Gemini] Image is very tall (${imageHeight}px). Slicing into chunks of ${sliceHeight}px...`);

    const slicePromises: Promise<TextOverlay[]>[] = [];
    let top = 0;
    let sliceIdx = 0;

    while (top < imageHeight) {
      const currentTop = top;
      const currentHeight = Math.min(sliceHeight, imageHeight - currentTop);
      const currentIdx = sliceIdx;

      slicePromises.push((async () => {
        try {
          console.log(`[Gemini] Extracting slice ${currentIdx} (top: ${currentTop}, height: ${currentHeight})...`);
          
          const sliceBuffer = await sharp(imageBuffer)
            .extract({ left: 0, top: currentTop, width: imageWidth, height: currentHeight })
            .toBuffer();

          const sliceOverlays = await translateSingleImageWithGemini(
            sliceBuffer,
            mimeType,
            imageWidth,
            currentHeight,
            apiKey,
            openRouterKey
          );

          if (!sliceOverlays) return [];

          // Offset the y coordinate by the slice's top position
          return sliceOverlays.map(overlay => ({
            ...overlay,
            bbox: {
              ...overlay.bbox,
              y: overlay.bbox.y + currentTop,
            }
          }));
        } catch (err) {
          console.error(`[Gemini] Failed to translate slice ${currentIdx} (top: ${currentTop}):`, err);
          return [];
        }
      })());

      if (top + currentHeight >= imageHeight) {
        break;
      }
      top += step;
      sliceIdx++;
    }

    const allSlicesOverlays = await Promise.all(slicePromises);
    const combinedOverlays = allSlicesOverlays.flat();

    const deduped = deduplicateOverlays(combinedOverlays);
    console.log(`[Gemini] Slices translation complete. Combined=${combinedOverlays.length}, Deduped=${deduped.length}`);
    return deduped;
  }

  // Process standard images in one go
  return translateSingleImageWithGemini(
    imageBuffer,
    mimeType,
    imageWidth,
    imageHeight,
    apiKey,
    openRouterKey
  );
}

// ── Single Image Translation ─────────────────────────────────────────

async function translateSingleImageWithGemini(
  imageBuffer: Buffer,
  mimeType: string,
  imageWidth: number,
  imageHeight: number,
  apiKey: string | undefined,
  openRouterKey: string | undefined
): Promise<TextOverlay[] | null> {
  try {
    const base64Image = imageBuffer.toString('base64');

    let responseText = '';

    // 1. Try OpenRouter first if key is present
    if (openRouterKey) {
      try {
        console.log('[Gemini/OpenRouter] Attempting vision translation via OpenRouter...');
        responseText = await tryOpenRouterModels(openRouterKey, [
          {
            role: 'user',
            content: [
              { type: 'text', text: VISION_PROMPT },
              {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64Image}` }
              }
            ]
          }
        ], true);
      } catch (err) {
        console.error('[Gemini/OpenRouter] OpenRouter vision translation failed:', err);
      }
    }

    // 2. Try direct Gemini key if present and OpenRouter failed
    if (!responseText && apiKey) {
      const response = await tryGeminiModels(apiKey, async (model) => {
        let retries = 2;
        let delay = 300;
        while (retries > 0) {
          try {
            return await model.generateContent({
              contents: [
                {
                  role: 'user',
                  parts: [
                    { inlineData: { mimeType, data: base64Image } },
                    { text: VISION_PROMPT },
                  ],
                },
              ],
              generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: {
                  type: SchemaType.OBJECT,
                  properties: {
                    bubbles: {
                      type: SchemaType.ARRAY,
                      description: 'All detected text elements on the page',
                      items: {
                        type: SchemaType.OBJECT,
                        properties: {
                          originalText: { type: SchemaType.STRING, description: 'Original text' },
                          translatedText: { type: SchemaType.STRING, description: 'Arabic translation (empty for non-translatable types)' },
                          bbox: {
                            type: SchemaType.OBJECT,
                            properties: {
                              ymin: { type: SchemaType.NUMBER, description: 'Top edge (0–1000)' },
                              xmin: { type: SchemaType.NUMBER, description: 'Left edge (0–1000)' },
                              ymax: { type: SchemaType.NUMBER, description: 'Bottom edge (0–1000)' },
                              xmax: { type: SchemaType.NUMBER, description: 'Right edge (0–1000)' },
                            },
                            required: ['ymin', 'xmin', 'ymax', 'xmax'],
                          },
                          textType: {
                            type: SchemaType.STRING,
                            description: 'Classification: speech_bubble, narration_box, sfx, watermark, chapter_title, decorative',
                          },
                          isVertical: {
                            type: SchemaType.BOOLEAN,
                            description: 'True if text is written vertically',
                          },
                          bubbleShape: {
                            type: SchemaType.STRING,
                            description: 'Shape: ellipse, rectangle, cloud, irregular',
                          },
                        },
                        required: ['originalText', 'translatedText', 'bbox', 'textType', 'isVertical', 'bubbleShape'],
                      },
                    },
                  },
                  required: ['bubbles'],
                },
              },
            });
          } catch (err: any) {
            if (err.message && (err.message.includes('429') || err.message.includes('quota') || err.message.includes('Limit'))) {
              throw err;
            }
            retries--;
            if (retries === 0) throw err;
            await new Promise((resolve) => setTimeout(resolve, delay));
            delay *= 2;
          }
        }
      });

      if (response) {
        responseText = response.response.text();
      }
    }

    if (!responseText) {
      throw new Error('Failed to get a response from either OpenRouter or Gemini API');
    }

    const result = JSON.parse(responseText) as GeminiResponse;
    if (!result.bubbles || !Array.isArray(result.bubbles)) {
      throw new Error('Invalid JSON structure returned by Gemini/OpenRouter');
    }

    return result.bubbles
      .map((b) => mapGeminiBubbleToOverlay(b, imageWidth, imageHeight))
      .filter(Boolean) as TextOverlay[];
  } catch (error) {
    console.error('[Gemini/OpenRouter] Vision call failed:', error);
    throw error;
  }
}

// ── Mapping ──────────────────────────────────────────────────────────

function mapGeminiBubbleToOverlay(
  b: GeminiBubble,
  imageWidth: number,
  imageHeight: number
): TextOverlay | null {
  const x = (b.bbox.xmin / 1000) * imageWidth;
  const y = (b.bbox.ymin / 1000) * imageHeight;
  const width = ((b.bbox.xmax - b.bbox.xmin) / 1000) * imageWidth;
  const height = ((b.bbox.ymax - b.bbox.ymin) / 1000) * imageHeight;

  // Guard against invalid bounding boxes
  if (width <= 0 || height <= 0) return null;

  // Detect vertical text via ratio heuristic as a fallback
  const isVertical = b.isVertical || (height / width > VERTICAL_TEXT_RATIO_THRESHOLD);

  // Classify text type with normalization
  const textType = normalizeTextType(b.textType);

  // Map bubble shape
  const bubbleShape = normalizeBubbleShape(b.bubbleShape);

  const bbox: BoundingBox = {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };

  // For vertical text, enforce compact bounding box
  const adjustedBbox = isVertical ? enforceCompactVerticalBox(bbox, imageWidth, imageHeight) : bbox;

  return {
    originalText: b.originalText,
    translatedText: b.translatedText,
    bbox: adjustedBbox,
    confidence: 100,
    textType,
    isVertical,
    bubblePolygon: {
      points: bboxToPolygonPoints(adjustedBbox),
      boundingBox: adjustedBbox,
      shape: bubbleShape,
    },
  };
}

function normalizeTextType(raw: string): TextType {
  const map: Record<string, TextType> = {
    'speech_bubble': 'speech_bubble',
    'speech': 'speech_bubble',
    'dialogue': 'speech_bubble',
    'narration_box': 'narration_box',
    'narration': 'narration_box',
    'narrator': 'narration_box',
    'sfx': 'sfx',
    'sound_effect': 'sfx',
    'watermark': 'watermark',
    'credit': 'watermark',
    'chapter_title': 'chapter_title',
    'title': 'chapter_title',
    'decorative': 'decorative',
  };
  return map[raw?.toLowerCase()] || 'speech_bubble';
}

function normalizeBubbleShape(raw: string): BubbleShape {
  const map: Record<string, BubbleShape> = {
    'ellipse': 'ellipse',
    'oval': 'ellipse',
    'circle': 'ellipse',
    'rectangle': 'rectangle',
    'rect': 'rectangle',
    'box': 'rectangle',
    'cloud': 'cloud',
    'thought': 'cloud',
    'irregular': 'irregular',
  };
  return map[raw?.toLowerCase()] || 'irregular';
}

/** Prevent vertical text regions from creating giant overlays */
function enforceCompactVerticalBox(bbox: BoundingBox, imgWidth: number, imgHeight: number): BoundingBox {
  const maxHeight = imgHeight * 0.25; // Never exceed 25% of image height
  const maxWidth = imgWidth * 0.08;   // Vertical text is narrow

  return {
    x: bbox.x,
    y: bbox.y,
    width: Math.min(bbox.width, maxWidth),
    height: Math.min(bbox.height, maxHeight),
  };
}

function bboxToPolygonPoints(bbox: BoundingBox): Array<{ x: number; y: number }> {
  return [
    { x: bbox.x, y: bbox.y },
    { x: bbox.x + bbox.width, y: bbox.y },
    { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
    { x: bbox.x, y: bbox.y + bbox.height },
  ];
}

// ── Deduplication ────────────────────────────────────────────────────

function deduplicateOverlays(overlays: TextOverlay[]): TextOverlay[] {
  const result: TextOverlay[] = [];

  for (const item of overlays) {
    let isDuplicate = false;
    for (let i = 0; i < result.length; i++) {
      const existing = result[i];
      // Lower threshold to 0.4 since manga speech bubbles do not naturally overlap
      if (boxesOverlapPercent(item.bbox, existing.bbox) > 0.4) {
        isDuplicate = true;
        // Keep the one with longer translation
        if (item.translatedText.length > existing.translatedText.length) {
          result[i] = item;
        }
        break;
      }
    }
    if (!isDuplicate) {
      result.push(item);
    }
  }

  return result;
}


function boxesOverlapPercent(a: BoundingBox, b: BoundingBox): number {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const overlapArea = xOverlap * yOverlap;

  if (overlapArea <= 0) return 0;

  const aArea = a.width * a.height;
  const bArea = b.width * b.height;
  const minArea = Math.min(aArea, bArea);

  return overlapArea / minArea;
}
