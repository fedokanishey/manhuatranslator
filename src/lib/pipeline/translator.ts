import translate from 'google-translate-api-x';
import { DEFAULT_TARGET_LANG } from '../constants';
import { getApiKey, tryGeminiModels } from './gemini';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

export interface TranslationInput {
  text: string;
  id: string;
}

export interface TranslationOutput {
  id: string;
  original: string;
  translated: string;
  detectedLanguage: string;
}

async function translateTextWithGemini(
  text: string,
  targetLang: string
): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Gemini API key not found');

  const response = await tryGeminiModels(apiKey, async (model) => {
    return await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Translate the following text to natural, fluent ${targetLang}. Only return the translation, nothing else. Do not add quotes unless they were in the original text.\n\nText: ${text}`
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.3,
      }
    });
  });

  const translated = response.response.text().trim();
  if (!translated) {
    throw new Error('Gemini returned empty translation');
  }
  return translated;
}

async function translateBatchWithGemini(
  inputs: TranslationInput[],
  targetLang: string
): Promise<TranslationOutput[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Gemini API key not found');

  const prompt = `Translate the following list of manga text blocks into natural, fluent ${targetLang}. 
Maintain the context across the blocks so the dialogue flows naturally.
Return the translations in a JSON object with a "translations" array, containing objects with "id" and "translated" fields matching the input.

Example output:
{
  "translations": [
    { "id": "1", "translated": "مرحبا" },
    { "id": "2", "translated": "كيف حالك؟" }
  ]
}`;

  const response = await tryGeminiModels(apiKey, async (model) => {
    return await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `${prompt}\n\nInput blocks:\n${JSON.stringify(inputs.map(i => ({ id: i.id, text: i.text })), null, 2)}`
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            translations: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  id: { type: SchemaType.STRING },
                  translated: { type: SchemaType.STRING }
                },
                required: ['id', 'translated']
              }
            }
          },
          required: ['translations']
        }
      }
    });
  });

  const responseText = response.response.text();
  const data = JSON.parse(responseText);
  
  return inputs.map(input => {
    const matched = data.translations?.find((t: any) => t.id === input.id);
    return {
      id: input.id,
      original: input.text,
      translated: matched ? matched.translated : `[Translation Error] ${input.text}`,
      detectedLanguage: 'unknown'
    };
  });
}

export async function translateText(
  text: string,
  targetLang: string = DEFAULT_TARGET_LANG
): Promise<TranslationOutput> {
  if (!text.trim()) {
    return {
      id: '',
      original: text,
      translated: text,
      detectedLanguage: 'unknown',
    };
  }

  if (getApiKey()) {
    try {
      console.log(`[Translator] Translating single text with Gemini to ${targetLang}...`);
      const translated = await translateTextWithGemini(text, targetLang);
      return {
        id: '',
        original: text,
        translated,
        detectedLanguage: 'unknown',
      };
    } catch (err) {
      console.error('[Translator] Gemini translation failed, falling back to Google Translate:', err);
    }
  }

  try {
    const result = await translate(text, { to: targetLang });
    
    return {
      id: '',
      original: text,
      translated: result.text,
      detectedLanguage: result.from.language.iso || 'unknown',
    };
  } catch (error) {
    console.error('[Translator] Failed:', error);
    // Return original text on failure rather than crashing
    return {
      id: '',
      original: text,
      translated: `[Translation Error] ${text}`,
      detectedLanguage: 'unknown',
    };
  }
}

export async function translateBatch(
  inputs: TranslationInput[],
  targetLang: string = DEFAULT_TARGET_LANG
): Promise<TranslationOutput[]> {
  if (inputs.length === 0) return [];

  if (getApiKey()) {
    try {
      console.log(`[Translator] Translating batch of ${inputs.length} text blocks with Gemini to ${targetLang}...`);
      return await translateBatchWithGemini(inputs, targetLang);
    } catch (err) {
      console.error('[Translator] Gemini batch translation failed, falling back to Google Translate chunks:', err);
    }
  }

  const results: TranslationOutput[] = [];

  // Process in chunks of 5 to avoid rate limiting
  const chunkSize = 5;
  for (let i = 0; i < inputs.length; i += chunkSize) {
    const chunk = inputs.slice(i, i + chunkSize);
    
    const chunkResults = await Promise.all(
      chunk.map(async (input) => {
        const result = await translateText(input.text, targetLang);
        return { ...result, id: input.id };
      })
    );

    results.push(...chunkResults);

    // Small delay between chunks to avoid rate limiting
    if (i + chunkSize < inputs.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return results;
}


export async function translateHtmlContent(
  textBlocks: Array<{ text: string; selector: string }>,
  targetLang: string = DEFAULT_TARGET_LANG
): Promise<Array<{ original: string; translated: string; selector: string }>> {
  const inputs: TranslationInput[] = textBlocks.map((block, index) => ({
    text: block.text,
    id: `block-${index}`,
  }));

  const results = await translateBatch(inputs, targetLang);

  return results.map((result, index) => ({
    original: result.original,
    translated: result.translated,
    selector: textBlocks[index].selector,
  }));
}
