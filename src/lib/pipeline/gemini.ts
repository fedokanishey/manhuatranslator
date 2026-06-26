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

function getApiKey(): string | undefined {
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

export async function translateImageWithGemini(
  imageBuffer: Buffer,
  mimeType: string,
  imageWidth: number,
  imageHeight: number
): Promise<TextOverlay[] | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.log('[Gemini] GEMINI_API_KEY is not configured. Skipping.');
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
            apiKey
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
    apiKey
  );
}

async function translateSingleImageWithGemini(
  imageBuffer: Buffer,
  mimeType: string,
  imageWidth: number,
  imageHeight: number,
  apiKey: string
): Promise<TextOverlay[] | null> {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
    const base64Image = imageBuffer.toString('base64');

    const prompt = `You are a manga/manhwa translator. Analyze this page image and find every speech bubble, narrator box, and text block.

For each one:
1. Extract the original text exactly as written.
2. Translate it into natural, fluent manga-style Arabic.
3. Return the bounding box of the INNER AREA of the speech bubble or narrator box (just inside the outer outlines/borders).

Bounding box format: ymin, xmin, ymax, xmax — normalized to a 0–1000 scale relative to image height and width.

IMPORTANT — bounding box accuracy:
- The bbox MUST cover the inside region of the speech bubble or narrator box where the text resides, but stay strictly INSIDE the black outlines/borders. I will use this bbox to place an opaque background rectangle to mask the original English text and render the Arabic translation centered inside it.
- Do NOT include the black outer outlines/borders of the speech bubbles in the bbox (so we don't cover or overwrite them).
- ymin = top edge of the inside bubble region, ymax = bottom edge of the inside bubble region.
- xmin = left edge of the inside bubble region, xmax = right edge of the inside bubble region.

What to include:
- All dialogue, narration, and thought bubbles.

What to exclude:
- Scanlation credits, translator notes, watermarks (e.g. "read first at", "mangacultivator"), and purely decorative SFX.`;

    let response: any;
    let retries = 3;
    let delay = 500;

    while (retries > 0) {
      try {
        response = await model.generateContent({
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
        break;
      } catch (err: any) {
        console.error(`[Gemini] API attempt failed. Retries left: ${retries - 1}. Error: ${err.message || err}`);
        retries--;
        if (retries === 0) throw err;
        
        console.log(`[Gemini] Waiting ${delay}ms before retrying...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }

    if (!response) {
      throw new Error('Failed to get a response from Gemini API');
    }

    const text = response.response.text();
    if (!text) {
      throw new Error('Empty response from Gemini API');
    }

    const result = JSON.parse(text) as GeminiResponse;
    if (!result.bubbles || !Array.isArray(result.bubbles)) {
      throw new Error('Invalid JSON structure returned by Gemini');
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
    console.error('[Gemini] Vision call failed:', error);
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
