import translate from 'google-translate-api-x';
import { DEFAULT_TARGET_LANG } from '../constants';

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
