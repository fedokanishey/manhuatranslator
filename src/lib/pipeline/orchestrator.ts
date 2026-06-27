/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { fetchWithFallback, fetchPage } from './fetcher';

import { parseHtml } from './parser';
import { processImage, processImages } from './image-processor';
import { runOCR } from './ocr';
import { translateImageWithGemini } from './gemini';
import { translateBatch, translateHtmlContent } from './translator';
import { inpaintImage } from './inpainter';
import { computePageLayouts } from './layout-engine';
import { getCached, setCache } from '../cache';
import {
  TRANSLATABLE_TEXT_TYPES,
  SKIP_TEXT_TYPES,
  type TextOverlay,
  type TranslationResult,
  type TranslatedPage,
  type TranslationProgress,
} from '@/types/translation';

type ProgressCallback = (progress: TranslationProgress) => void;

// ── Main Pipeline ────────────────────────────────────────────────────

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
    // Step 1: Fetch page with fallback strategies
    onProgress?.({ stage: 'fetching', progress: 10, message: 'Fetching chapter page...' });
    const fetchResult = await fetchWithFallback(url);

    // If all fetch strategies failed, return structured error
    if (!fetchResult.result) {
      return {
        success: false,
        title: 'Access Blocked',
        sourceUrl: url,
        contentType: 'text',
        cached: false,
        processedAt: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
        error: fetchResult.error?.message || 'Failed to access the website',
        fetchError: fetchResult.error,
      };
    }

    console.log(`[Pipeline] Fetched page via ${fetchResult.strategy}, HTML length:`, fetchResult.result.html.length);

    // Step 2: Parse HTML
    onProgress?.({ stage: 'parsing', progress: 20, message: 'Analyzing page structure...' });
    const parsed = parseHtml(fetchResult.result.html, fetchResult.result.finalUrl);
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

// ── Image Content Pipeline ───────────────────────────────────────────

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

  const ocrLangs = detectSourceLanguages(parsed.textBlocks, parsed.title);
  console.log(`[Pipeline] Detected source language(s) for OCR:`, ocrLangs);

  onProgress?.({ stage: 'running-ocr', progress: 50, message: 'Running text recognition (OCR)...' });
  const pages: TranslatedPage[] = [];

  for (let i = 0; i < processedImages.length; i++) {
    const img = processedImages[i];
    
    onProgress?.({
      stage: 'running-ocr',
      progress: 50 + (i / processedImages.length) * 20,
      message: `OCR: Image ${i + 1}/${processedImages.length}`,
    });

    const page = await processPagePipeline(
      img.buffer,
      img.mimeType,
      img.width,
      img.height,
      img.originalSrc,
      i,
      ocrLangs,
      targetLang,
      onProgress
    );

    pages.push(page);
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

// ── Single Page Pipeline ─────────────────────────────────────────────
// New pipeline:
//   Image → Gemini (Bubble Detection + OCR + Translation + Classification)
//   → Filter (translatable types only)
//   → Layout Engine (compute font sizes, line breaks)
//   → Inpainting (remove original text)
//   → Return inpainted image + overlay layout data

async function processPagePipeline(
  imageBuffer: Buffer,
  mimeType: string,
  imageWidth: number,
  imageHeight: number,
  imageUrl: string,
  pageIndex: number,
  ocrLangs: string[],
  targetLang: string,
  onProgress?: ProgressCallback
): Promise<TranslatedPage> {
  let overlays: TextOverlay[] = [];
  let geminiSuccess = false;
  let geminiError: any = null;


  // Step 1: Gemini Vision (OCR + Translation + Classification)
  if (process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY) {
    console.log(`[Pipeline] Using Gemini Vision for page ${pageIndex}...`);
    try {
      const geminiResult = await translateImageWithGemini(
        imageBuffer,
        mimeType,
        imageWidth,
        imageHeight
      );
      if (geminiResult) {
        overlays = geminiResult;
        geminiSuccess = true;
      }
    } catch (err) {
      console.error(`[Pipeline] Gemini failed for page ${pageIndex}:`, err);
      geminiError = err;
    }
  }

  // Fallback: Tesseract OCR + Google Translate
  // Only run fallback if Gemini was not successful (e.g. API error or disabled)
  if (!geminiSuccess) {
    if (process.env.VERCEL === '1') {
      throw new Error(`Gemini: ${geminiError?.message || 'Key missing'}`);
    }
    console.log(`[Pipeline] Running Tesseract OCR fallback for page ${pageIndex}...`);
    try {
      const ocrResult = await runOCR(imageBuffer, ocrLangs);
      console.log(`[Pipeline] OCR page ${pageIndex}: words=${ocrResult.words.length}, confidence=${ocrResult.averageConfidence.toFixed(1)}`);

      if (ocrResult.words.length > 0) {
        const translationInputs = ocrResult.words.map((word, idx) => ({
          text: word.text,
          id: `img-${pageIndex}-word-${idx}`,
        }));

        const translations = await translateBatch(translationInputs, targetLang);
        overlays = ocrResult.words.map((word, idx) => ({
          originalText: word.text,
          translatedText: translations[idx]?.translated || word.text,
          bbox: word.bbox,
          confidence: word.confidence,
          textType: word.textType,
          isVertical: word.isVertical,
        }));
      }
    } catch (ocrErr) {
      console.error(`[Pipeline] OCR fallback failed for page ${pageIndex}:`, ocrErr);
      // Do not throw, keep overlays empty and return the original image
    }
  }


  // Step 2: Filter — keep only translatable types
  const translatableOverlays = overlays.filter((o) => {
    if (!o.textType) return true; // No classification = treat as translatable
    if (SKIP_TEXT_TYPES.includes(o.textType)) {
      console.log(`[Pipeline] Skipping ${o.textType}: "${o.originalText.slice(0, 30)}"`);
      return false;
    }
    return true;
  });

  console.log(`[Pipeline] Page ${pageIndex}: ${overlays.length} total overlays, ${translatableOverlays.length} translatable`);

  // Step 3: Layout Engine — compute font sizes and line breaks
  const layoutOverlays = computePageLayouts(translatableOverlays);

  // Step 4: Inpainting — remove original text from image
  const inpaintResult = await inpaintImage(
    imageBuffer,
    translatableOverlays,
    imageWidth,
    imageHeight
  );

  return {
    pageIndex,
    imageUrl,
    imageBase64: inpaintResult.base64,
    width: imageWidth,
    height: imageHeight,
    overlays: layoutOverlays,
    inpaintedRegions: inpaintResult.regions,
  };
}

// ── Public: Single Page Translation ──────────────────────────────────

export async function processSinglePage(
  imageUrl: string,
  index: number,
  targetLang: string = 'ar',
  langs?: string[],
  imageBase64?: string
): Promise<TranslatedPage> {
  const cacheKey = `page::${imageUrl}::${targetLang}`;

  // Check page-level cache
  const cached = getCached<TranslatedPage>(cacheKey);
  if (cached) {
    console.log(`[Pipeline] Page ${index} cache hit.`);
    return cached;
  }

  let imgBuffer: Buffer;
  let imgWidth: number;
  let imgHeight: number;
  let mimeType: string;

  if (imageBase64) {
    // Handle uploaded images (base64 data)
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    imgBuffer = Buffer.from(base64Data, 'base64');
    const sharp = (await import('sharp')).default;
    const metadata = await sharp(imgBuffer).metadata();
    imgWidth = metadata.width || 0;
    imgHeight = metadata.height || 0;
    mimeType = 'image/png';
  } else {
    // Download from URL
    const img = await processImage(imageUrl, index);
    imgBuffer = img.buffer;
    imgWidth = img.width;
    imgHeight = img.height;
    mimeType = img.mimeType;
  }

  const ocrLangs = langs && langs.length > 0 ? langs : ['eng'];

  const resultPage = await processPagePipeline(
    imgBuffer,
    mimeType,
    imgWidth,
    imgHeight,
    imageUrl,
    index,
    ocrLangs,
    targetLang
  );

  if (imageBase64) {
    resultPage.originalBase64 = imageBase64;
  }

  // Cache the page-level translation
  setCache(cacheKey, resultPage);

  return resultPage;
}

// ── Text Content Pipeline ────────────────────────────────────────────

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

// ── Language Detection ───────────────────────────────────────────────

function detectSourceLanguages(
  textBlocks: Array<{ text: string }>,
  title: string
): string[] {
  const sampleText = (title + ' ' + textBlocks.map((b) => b.text).join(' ')).toLowerCase();

  if (/[\uac00-\ud7af]/.test(sampleText)) {
    return ['kor', 'eng'];
  }

  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(sampleText)) {
    return ['jpn', 'eng'];
  }

  if (/[\u4e00-\u9faf]/.test(sampleText)) {
    return ['chi_sim', 'eng'];
  }

  return ['eng'];
}
