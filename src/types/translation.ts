export type ContentType = 'text' | 'image' | 'mixed';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OCRWord {
  text: string;
  confidence: number;
  bbox: BoundingBox;
}

export interface OCRResult {
  words: OCRWord[];
  fullText: string;
  averageConfidence: number;
  language: string;
}

export interface TextOverlay {
  originalText: string;
  translatedText: string;
  bbox: BoundingBox;
  confidence: number;
}

export interface TranslatedPage {
  pageIndex: number;
  imageUrl: string;
  imageBase64: string;
  width: number;
  height: number;
  overlays: TextOverlay[];
}

export interface TranslatedTextBlock {
  original: string;
  translated: string;
  selector: string;
}

export interface TranslationResult {
  success: boolean;
  title: string;
  sourceUrl: string;
  contentType: ContentType;
  translatedHtml?: string;
  textBlocks?: TranslatedTextBlock[];
  pages?: TranslatedPage[];
  cached: boolean;
  processedAt: string;
  processingTimeMs: number;
  error?: string;
}

export interface TranslationRequest {
  url: string;
  targetLang?: string;
}

export interface TranslationProgress {
  stage: PipelineStage;
  progress: number;
  message: string;
}

export type PipelineStage =
  | 'validating'
  | 'fetching'
  | 'parsing'
  | 'downloading-images'
  | 'running-ocr'
  | 'translating'
  | 'reconstructing'
  | 'complete'
  | 'error';
