export type ContentType = 'text' | 'image' | 'mixed';

// ── Text Classification ──────────────────────────────────────────────
export type TextType =
  | 'speech_bubble'
  | 'narration_box'
  | 'sfx'
  | 'watermark'
  | 'chapter_title'
  | 'decorative';

/** Text types that should be translated by default */
export const TRANSLATABLE_TEXT_TYPES: TextType[] = ['speech_bubble', 'narration_box'];

/** Text types that should be skipped by default */
export const SKIP_TEXT_TYPES: TextType[] = ['watermark', 'decorative', 'chapter_title'];

/** Text types that are optionally translated (user toggle) */
export const OPTIONAL_TEXT_TYPES: TextType[] = ['sfx'];

// ── Geometry ─────────────────────────────────────────────────────────
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BubbleShape = 'ellipse' | 'rectangle' | 'cloud' | 'irregular';

export interface BubblePolygon {
  /** Ordered list of polygon vertices (for irregular/cloud shapes) */
  points: Array<{ x: number; y: number }>;
  /** Axis-aligned bounding box enclosing the polygon */
  boundingBox: BoundingBox;
  /** Classified shape of the bubble */
  shape: BubbleShape;
}

// ── Layout Engine Output ─────────────────────────────────────────────
export interface LayoutResult {
  /** Computed optimal font size in pixels (relative to original image dimensions) */
  fontSize: number;
  /** Text broken into balanced lines */
  lines: string[];
  /** Total rendered height of all lines */
  totalHeight: number;
  /** X offset within the bubble for centering */
  offsetX: number;
  /** Y offset within the bubble for centering */
  offsetY: number;
  /** Usable width for text (may be smaller than bbox for elliptical bubbles) */
  usableWidth: number;
  /** Font weight to use */
  fontWeight: number;
}

// ── OCR ──────────────────────────────────────────────────────────────
export interface OCRWord {
  text: string;
  confidence: number;
  bbox: BoundingBox;
  isVertical?: boolean;
  textType?: TextType;
}

export interface OCRResult {
  words: OCRWord[];
  fullText: string;
  averageConfidence: number;
  language: string;
}

// ── Text Overlay (per-bubble output) ─────────────────────────────────
export interface TextOverlay {
  originalText: string;
  translatedText: string;
  bbox: BoundingBox;
  confidence: number;
  /** Classified text type */
  textType?: TextType;
  /** Detected bubble geometry (if available) */
  bubblePolygon?: BubblePolygon;
  /** Whether the original text was vertical (CJK) */
  isVertical?: boolean;
  /** Server-computed layout for Arabic rendering */
  layoutResult?: LayoutResult;
}

// ── Inpainting ───────────────────────────────────────────────────────
export interface InpaintedRegion {
  /** Bounding box that was inpainted */
  bbox: BoundingBox;
  /** Fill color used */
  fillColor: string;
  /** Shape of the inpainted mask */
  shape: BubbleShape;
}

// ── Page & Result ────────────────────────────────────────────────────
export interface TranslatedPage {
  pageIndex: number;
  imageUrl: string;
  /** Base64 of the INPAINTED image (original text removed) */
  imageBase64: string;
  /** Base64 of the ORIGINAL image (with original text) */
  originalBase64?: string;
  width: number;
  height: number;
  overlays: TextOverlay[];
  /** Regions that were inpainted */
  inpaintedRegions?: InpaintedRegion[];
  loading?: boolean;
  error?: string;
}


export interface TranslatedTextBlock {
  original: string;
  translated: string;
  selector: string;
}

export interface ParsedImage {
  src: string;
  alt: string;
  index: number;
  width?: number;
  height?: number;
}

export interface TranslationResult {
  success: boolean;
  title: string;
  sourceUrl: string;
  contentType: ContentType;
  translatedHtml?: string;
  textBlocks?: TranslatedTextBlock[];
  pages?: TranslatedPage[];
  images?: ParsedImage[];
  langs?: string[];
  cached: boolean;
  processedAt: string;
  processingTimeMs: number;
  error?: string;
  /** Structured error for anti-bot / access failures */
  fetchError?: FetchError;
}

// ── Fetch Errors ─────────────────────────────────────────────────────
export type FetchErrorType =
  | 'cloudflare'
  | 'forbidden'
  | 'timeout'
  | 'network'
  | 'unknown';

export interface FetchError {
  type: FetchErrorType;
  message: string;
  /** User-friendly suggestion */
  suggestion: string;
}

// ── Upload ───────────────────────────────────────────────────────────
export interface UploadedImage {
  /** Original filename */
  filename: string;
  /** Image buffer */
  buffer: Buffer;
  /** MIME type */
  mimeType: string;
  /** Sort order (from filename or upload order) */
  index: number;
}

// ── Requests & Progress ──────────────────────────────────────────────
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
  | 'bubble-detection'
  | 'running-ocr'
  | 'classifying'
  | 'translating'
  | 'inpainting'
  | 'layout-engine'
  | 'reconstructing'
  | 'uploading'
  | 'complete'
  | 'error';
