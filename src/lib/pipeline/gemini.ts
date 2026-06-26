import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { TextOverlay, BoundingBox } from '@/types/translation';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

interface GeminiBubble {
  originalText: string;
  translatedText: string;
  bbox: {
    ymin: number;
    xmin: number;
    ymax: number;
    xmax: number;
  };
}

interface GeminiResponse {
  bubbles: GeminiBubble[];
}

export function getApiKey(): string | undefined {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }
  
  // Try loading from .env.local manually to avoid dev server restart
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

export async function tryGeminiModels<T>(
  apiKey: string,
  executeFn: (model: any) => Promise<T>
): Promise<T> {
  const genAI = new GoogleGenerativeAI(apiKey);
  let lastError: any = null;

  for (const modelName of GEMINI_MODELS) {
    try {
      console.log(`[Gemini] Attempting call with model: ${modelName}...`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await executeFn(model);
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

  for (const modelName of OPENROUTER_MODELS) {
    try {
      console.log(`[OpenRouter] Attempting call with model: ${modelName}...`);
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

      console.log(`[OpenRouter] Success using model: ${modelName}`);
      return text;
    } catch (err: any) {
      console.warn(`[OpenRouter] Model ${modelName} failed or quota exceeded:`, err.message || err);
      lastError = err;
    }
  }

  throw new Error(`All OpenRouter models failed. Last error: ${lastError?.message || lastError}`);
}

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

    console.log(`[Gemini] Image is very tall (${imageHeight}px). Slicing into standard chunks of ${sliceHeight}px vertically to prevent coordinate distortion...`);

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

    const prompt = `You are a manga/manhwa translator. Analyze this page image and find every speech bubble, narrator box, and text block containing dialogue, narration, or spoken words.

For each text element detected:
1. Extract the original text exactly as written.
2. Translate it into natural, fluent manga-style Arabic.
3. Return the bounding box of the INNER AREA of the speech bubble or narrator box (just inside the outer outlines/borders) or a tight bounding box around the text if it is written directly on the artwork without borders.

Bounding box format: ymin, xmin, ymax, xmax — normalized to a 0–1000 scale relative to image height and width.

IMPORTANT — bounding box accuracy:
- If the text is inside a speech bubble or narrator box: The bbox MUST cover the inside region of the speech bubble or narrator box where the text resides, but stay strictly INSIDE the black outlines/borders. I will use this bbox to place an opaque background rectangle to mask the original English text and render the Arabic translation centered inside it. Do NOT include the outer outlines/borders of the speech bubbles in the bbox (so we don't cover or overwrite them).
- If the text is written directly on the background/artwork and has no outline/border: Return a tight bounding box wrapping the text lines.
- ymin = top edge of the region, ymax = bottom edge of the region.
- xmin = left edge of the region, xmax = right edge of the region.

What to include:
- All dialogue, narration, and thought bubbles.
- Any other text blocks, captions, or text written directly on the background containing spoken words or conversation.
- Even if a text block does not have a speech bubble outline or border, you MUST still detect it.

What to exclude:
- Scanlation credits, website URLs, translator notes, watermarks, and purely decorative/non-verbal SFX (like "WOOSH", "BAM", "CLANG").`;

    let responseText = '';

    // 1. Try OpenRouter first if key is present
    if (openRouterKey) {
      try {
        console.log('[Gemini/OpenRouter] Attempting vision translation via OpenRouter...');
        responseText = await tryOpenRouterModels(openRouterKey, [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`
                }
              }
            ]
          }
        ], true);
      } catch (err) {
        console.error('[Gemini/OpenRouter] OpenRouter vision translation failed:', err);
        // Fall through to direct Gemini
      }
    }

    // 2. Try direct Gemini key if present and OpenRouter failed/was not used
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
                    {
                      inlineData: {
                        mimeType,
                        data: base64Image,
                      },
                    },
                    {
                      text: prompt,
                    },
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
                      description: 'List of detected speech bubbles and text overlays',
                      items: {
                        type: SchemaType.OBJECT,
                        properties: {
                          originalText: { type: SchemaType.STRING, description: 'Original text in English/Korean/Japanese' },
                          translatedText: { type: SchemaType.STRING, description: 'Arabic translation of the text' },
                          bbox: {
                            type: SchemaType.OBJECT,
                            properties: {
                              ymin: { type: SchemaType.NUMBER, description: 'Top edge coordinate (0 to 1000)' },
                              xmin: { type: SchemaType.NUMBER, description: 'Left edge coordinate (0 to 1000)' },
                              ymax: { type: SchemaType.NUMBER, description: 'Bottom edge coordinate (0 to 1000)' },
                              xmax: { type: SchemaType.NUMBER, description: 'Right edge coordinate (0 to 1000)' },
                            },
                            required: ['ymin', 'xmin', 'ymax', 'xmax'],
                          },
                        },
                        required: ['originalText', 'translatedText', 'bbox'],
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

    return result.bubbles.map((b) => {
      const x = (b.bbox.xmin / 1000) * imageWidth;
      const y = (b.bbox.ymin / 1000) * imageHeight;
      const width = ((b.bbox.xmax - b.bbox.xmin) / 1000) * imageWidth;
      const height = ((b.bbox.ymax - b.bbox.ymin) / 1000) * imageHeight;

      return {
        originalText: b.originalText,
        translatedText: b.translatedText,
        bbox: {
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(width),
          height: Math.round(height),
        } as BoundingBox,
        confidence: 100,
      };
    });
  } catch (error) {
    console.error('[Gemini/OpenRouter] Vision call failed:', error);
    throw error;
  }
}

function deduplicateOverlays(overlays: TextOverlay[]): TextOverlay[] {
  const result: TextOverlay[] = [];

  for (const item of overlays) {
    let isDuplicate = false;
    for (let i = 0; i < result.length; i++) {
      const existing = result[i];
      if (boxesOverlapPercent(item.bbox, existing.bbox) > 0.6) {
        isDuplicate = true;
        // Keep the one with longer translation (usually more complete/correct)
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
