import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { TextOverlay, BoundingBox } from '@/types/translation';
import * as fs from 'fs';
import * as path from 'path';

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

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const base64Image = imageBuffer.toString('base64');

    const prompt = `Analyze this manga/manhwa page. Detect all speech bubbles, narrator boxes, and text blocks.
For each text block, extract the original text, translate it to natural manga-style Arabic, and return its bounding box.
Coordinates in the bounding box must be normalized on a 0-1000 scale: ymin, xmin, ymax, xmax relative to the image height and width.

Guidelines:
- Include all dialogue and narration bubbles.
- Exclude scanlation credits, translator notes, website watermarks (e.g. readfirst at, mangacultivator, etc.), and sound effects (SFX) that are part of the art background unless they contain crucial plot dialogue.
- Make the Arabic translation natural, fluent, and highly context-aware.`;

    let response: any;
    let retries = 3;
    let delay = 2000;

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
        break; // Success
      } catch (err: any) {
        console.error(`[Gemini] API attempt failed. Retries left: ${retries - 1}. Error:`, err.message || err);
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

    console.log(`[Gemini] Vision API returned ${result.bubbles.length} bubbles.`);

    // Convert 0-1000 normalized coordinates back to pixel coordinates
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
        confidence: 100, // Gemini translations are treated with full confidence
      };
    });
  } catch (error) {
    console.error('[Gemini] Translation failed:', error);
    throw error;
  }
}
