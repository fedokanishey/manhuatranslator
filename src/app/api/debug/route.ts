import { NextResponse } from 'next/server';
import { runOCR } from '@/lib/pipeline/ocr';
import { translateText } from '@/lib/pipeline/translator';

export async function GET() {
  const diagnostics: Record<string, unknown> = {};

  // Test 1: Translation
  try {
    const transResult = await translateText('Hello world', 'ar');
    diagnostics.translation = {
      status: 'OK',
      input: 'Hello world',
      output: transResult.translated,
      detectedLang: transResult.detectedLanguage,
    };
  } catch (err) {
    diagnostics.translation = {
      status: 'FAILED',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Test 2: OCR with a simple white image with text
  // We'll skip actual OCR test (needs real image) but check if Tesseract loads
  try {
    // Create a tiny 1x1 white PNG buffer for a quick smoke test
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      'base64'
    );
    const ocrResult = await runOCR(tinyPng);
    diagnostics.ocr = {
      status: 'OK',
      wordsFound: ocrResult.words.length,
      fullText: ocrResult.fullText,
      confidence: ocrResult.averageConfidence,
    };
  } catch (err) {
    diagnostics.ocr = {
      status: 'FAILED',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return NextResponse.json({
    service: 'MangaLens Diagnostics',
    timestamp: new Date().toISOString(),
    diagnostics,
  });
}
