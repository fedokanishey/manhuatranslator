import { fetchPage } from './fetcher';
import { parseHtml } from './parser';
import { processImage, processImages } from './image-processor';
import { runOCR } from './ocr';
import { translateImageWithGemini } from './gemini';
import { translateBatch, translateHtmlContent } from './translator';
import { getCached, setCache } from '../cache';
import type {
  TranslationResult,
  TranslatedPage,
  TextOverlay,
  TranslationProgress,
} from '@/types/translation';

type ProgressCallback = (progress: TranslationProgress) => void;

export async function runTranslationPipeline(
  url: string,
  targetLang: string = 'ar',
  full: boolean = false,
  onProgress?: ProgressCallback
): Promise<TranslationResult> {
  const startTime = Date.now();
  const cacheKey = `${url}::${targetLang}`;

  // Step 0: Check cache
  const cached = getCached<TranslationResult>(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  try {
    // Step 1: Fetch page
    onProgress?.({ stage: 'fetching', progress: 10, message: 'Fetching chapter page...' });
    const fetchResult = await fetchPage(url);
    console.log('[Pipeline] Fetched page, HTML length:', fetchResult.html.length);

    // Step 2: Parse HTML
    onProgress?.({ stage: 'parsing', progress: 20, message: 'Analyzing page structure...' });
    const parsed = parseHtml(fetchResult.html, fetchResult.finalUrl);
    console.log('[Pipeline] Parsed:', { contentType: parsed.contentType, images: parsed.images.length, textBlocks: parsed.textBlocks.length });

    // Step 3: Process based on content type
    let result: TranslationResult;

    if (parsed.contentType === 'image' || parsed.contentType === 'mixed') {
      if (full) {
        result = await processImageContent(
          parsed,
          targetLang,
          url,
          startTime,
          onProgress
        );
      } else {
        // Multi-step translation: return image URLs list and detected language
        onProgress?.({ stage: 'translating', progress: 50, message: 'Analyzing text blocks...' });
        const ocrLangs = detectSourceLanguages(parsed.textBlocks, parsed.title);
        
        let textBlocks;
        if (parsed.contentType === 'mixed' && parsed.textBlocks.length > 0) {
          textBlocks = await translateHtmlContent(parsed.textBlocks, targetLang);
        }

        result = {
          success: true,
          title: parsed.title,
          sourceUrl: url,
          contentType: parsed.contentType,
          images: parsed.images,
          textBlocks,
          langs: ocrLangs,
          cached: false,
          processedAt: new Date().toISOString(),
          processingTimeMs: Date.now() - startTime,
        };
      }
    } else {
      result = await processTextContent(
        parsed,
        targetLang,
        url,
        startTime,
        onProgress
      );
    }

    // Cache the result
    setCache(cacheKey, result);

    onProgress?.({ stage: 'complete', progress: 100, message: 'Translation complete!' });
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    onProgress?.({ stage: 'error', progress: 0, message: errorMessage });

    return {
      success: false,
      title: 'Translation Failed',
      sourceUrl: url,
      contentType: 'text',
      cached: false,
      processedAt: new Date().toISOString(),
      processingTimeMs: Date.now() - startTime,
      error: errorMessage,
    };
  }
}

async function processImageContent(
  parsed: ReturnType<typeof parseHtml>,
  targetLang: string,
  sourceUrl: string,
  startTime: number,
  onProgress?: ProgressCallback
): Promise<TranslationResult> {
  // Download and process images
  onProgress?.({ stage: 'downloading-images', progress: 30, message: `Downloading ${parsed.images.length} images...` });
  const processedImages = await processImages(parsed.images);

  if (processedImages.length === 0) {
    throw new Error('No images could be processed from this chapter');
  }

  // Determine source languages for OCR based on page content/metadata language
  const ocrLangs = detectSourceLanguages(parsed.textBlocks, parsed.title);
  console.log(`[Pipeline] Detected source language(s) for OCR:`, ocrLangs);

  // Run OCR on all images
  onProgress?.({ stage: 'running-ocr', progress: 50, message: 'Running text recognition (OCR)...' });
  const pages: TranslatedPage[] = [];

  for (let i = 0; i < processedImages.length; i++) {
    const img = processedImages[i];
    
    onProgress?.({
      stage: 'running-ocr',
      progress: 50 + (i / processedImages.length) * 20,
      message: `OCR: Image ${i + 1}/${processedImages.length}`,
    });

    let overlays: TextOverlay[] = [];
    let geminiError: any = null;

    // Try Gemini Vision OCR + Translation first
    if (process.env.GEMINI_API_KEY) {
      console.log(`[Pipeline] Using Gemini Vision for image ${i}...`);
      try {
        const geminiResult = await translateImageWithGemini(
          img.buffer,
          img.mimeType,
          img.width,
          img.height
        );
        if (geminiResult) {
          overlays = geminiResult;
        }
      } catch (err) {
        console.error(`[Pipeline] Gemini failed for image ${i}:`, err);
        geminiError = err;
      }
    }

    // Fallback to local Tesseract OCR + Google Translate
    if (overlays.length === 0) {
      if (process.env.VERCEL === '1') {
        throw new Error(`Gemini: ${geminiError?.message || 'Key missing'}`);
      }
      console.log(`[Pipeline] Running Tesseract OCR for image ${i}...`);
      const ocrResult = await runOCR(img.buffer, ocrLangs);
      console.log(`[Pipeline] OCR image ${i}: words=${ocrResult.words.length}, text="${ocrResult.fullText.slice(0, 100)}", confidence=${ocrResult.averageConfidence.toFixed(1)}`);

      if (ocrResult.words.length > 0) {
        const translationInputs = ocrResult.words.map((word, idx) => ({
          text: word.text,
          id: `img-${i}-word-${idx}`,
        }));

        onProgress?.({
          stage: 'translating',
          progress: 70 + (i / processedImages.length) * 20,
          message: `Translating: Image ${i + 1}/${processedImages.length}`,
        });

        const translations = await translateBatch(translationInputs, targetLang);
        console.log(`[Pipeline] Translated ${translations.length} words for image ${i}:`, translations.map(t => `"${t.original}" -> "${t.translated}"`));

        overlays = ocrResult.words.map((word, idx) => ({
          originalText: word.text,
          translatedText: translations[idx]?.translated || word.text,
          bbox: word.bbox,
          confidence: word.confidence,
        }));
      }
    }
    console.log(`[Pipeline] Image ${i}: ${overlays.length} overlays created`);

    pages.push({
      pageIndex: i,
      imageUrl: img.originalSrc,
      imageBase64: img.base64,
      width: img.width,
      height: img.height,
      overlays,
    });
  }

  // Also translate text blocks if mixed content
  let textBlocks;
  if (parsed.contentType === 'mixed' && parsed.textBlocks.length > 0) {
    onProgress?.({ stage: 'translating', progress: 90, message: 'Translating text content...' });
    textBlocks = await translateHtmlContent(parsed.textBlocks, targetLang);
  }

  return {
    success: true,
    title: parsed.title,
    sourceUrl,
    contentType: parsed.contentType,
    pages,
    textBlocks,
    cached: false,
    processedAt: new Date().toISOString(),
    processingTimeMs: Date.now() - startTime,
  };
}

async function processTextContent(
  parsed: ReturnType<typeof parseHtml>,
  targetLang: string,
  sourceUrl: string,
  startTime: number,
  onProgress?: ProgressCallback
): Promise<TranslationResult> {
  if (parsed.textBlocks.length === 0) {
    throw new Error('No translatable text content found on this page');
  }

  onProgress?.({ stage: 'translating', progress: 50, message: 'Translating text...' });
  const translatedBlocks = await translateHtmlContent(parsed.textBlocks, targetLang);

  return {
    success: true,
    title: parsed.title,
    sourceUrl,
    contentType: 'text',
    textBlocks: translatedBlocks,
    cached: false,
    processedAt: new Date().toISOString(),
    processingTimeMs: Date.now() - startTime,
  };
}

function detectSourceLanguages(
  textBlocks: Array<{ text: string }>,
  title: string
): string[] {
  const sampleText = (title + ' ' + textBlocks.map((b) => b.text).join(' ')).toLowerCase();

  // Check for Korean Hangul (U+AC00 to U+D7AF)
  if (/[\uac00-\ud7af]/.test(sampleText)) {
    return ['kor', 'eng'];
  }

  // Check for Japanese Hiragana/Katakana (U+3040 to U+30FF)
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(sampleText)) {
    return ['jpn', 'eng'];
  }

  // Check for Chinese (Han ideographs)
  if (/[\u4e00-\u9faf]/.test(sampleText)) {
    return ['chi_sim', 'eng'];
  }

  // Default to English only (dramatically increases accuracy and speed for scanlated manga)
  return ['eng'];
}

export async function processSinglePage(
  imageUrl: string,
  index: number,
  targetLang: string = 'ar',
  langs?: string[]
): Promise<TranslatedPage> {
  const cacheKey = `page::${imageUrl}::${targetLang}`;

  // Check page-level cache
  const cached = getCached<TranslatedPage>(cacheKey);
  if (cached) {
    console.log(`[Pipeline] Page ${index} cache hit.`);
    return cached;
  }

  // 1. Process image (download and resize/sharp)
  const img = await processImage(imageUrl, index);
  
  let overlays: TextOverlay[] = [];
  let geminiError: any = null;

  // Try Gemini Vision OCR + Translation first
  if (process.env.GEMINI_API_KEY) {
    console.log(`[Pipeline] Using Gemini Vision for page ${index}...`);
    try {
      const geminiResult = await translateImageWithGemini(
        img.buffer,
        img.mimeType,
        img.width,
        img.height
      );
      if (geminiResult) {
        overlays = geminiResult;
      }
    } catch (err) {
      console.error(`[Pipeline] Gemini failed for page ${index}:`, err);
      geminiError = err;
    }
  }

  // Fallback to Tesseract OCR + Google Translate
  if (overlays.length === 0) {
    if (process.env.VERCEL === '1') {
      throw new Error(`Gemini: ${geminiError?.message || 'Key missing'}`);
    }
    console.log(`[Pipeline] Running Tesseract OCR fallback for page ${index}...`);
    const ocrLangs = langs && langs.length > 0 ? langs : ['eng'];
    const ocrResult = await runOCR(img.buffer, ocrLangs);
    console.log(`[Pipeline] OCR page ${index}: words=${ocrResult.words.length}, confidence=${ocrResult.averageConfidence.toFixed(1)}`);

    if (ocrResult.words.length > 0) {
      const translationInputs = ocrResult.words.map((word, idx) => ({
        text: word.text,
        id: `img-${index}-word-${idx}`,
      }));

      const translations = await translateBatch(translationInputs, targetLang);
      overlays = ocrResult.words.map((word, idx) => ({
        originalText: word.text,
        translatedText: translations[idx]?.translated || word.text,
        bbox: word.bbox,
        confidence: word.confidence,
      }));
    }
  }

  const resultPage: TranslatedPage = {
    pageIndex: index,
    imageUrl: img.originalSrc,
    imageBase64: img.base64,
    width: img.width,
    height: img.height,
    overlays,
  };

  // Cache the page-level translation
  setCache(cacheKey, resultPage);

  return resultPage;
}

