export const APP_NAME = 'MangaLens';
export const APP_DESCRIPTION = 'AI-Powered Manga & Manhwa Translator — Instant Arabic translations with OCR technology';

export const SUPPORTED_LANGUAGES = {
  ar: 'Arabic',
  en: 'English',
  fr: 'French',
  es: 'Spanish',
} as const;

export const DEFAULT_TARGET_LANG = 'ar';

export const OCR_LANGUAGES = ['eng', 'jpn', 'kor', 'chi_sim', 'chi_tra'] as const;

export const FETCH_TIMEOUT_MS = 30_000;
export const OCR_TIMEOUT_MS = 60_000;
export const MAX_IMAGES_PER_CHAPTER = 100;
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MIN_OCR_CONFIDENCE = 40;

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
export const RATE_LIMIT_MAX_REQUESTS = 10;

// Private IP ranges to block for SSRF
export const BLOCKED_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
  /^fc00:/i,
  /^fe80:/i,
  /^::1$/,
  /^localhost$/i,
];

export const BLOCKED_PROTOCOLS = ['file:', 'ftp:', 'data:', 'javascript:'];

export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const FEATURES = [
  {
    title: 'Smart OCR',
    description: 'Advanced text recognition that reads Japanese, Korean, and Chinese characters from manga images',
    icon: 'scan',
  },
  {
    title: 'Arabic Translation',
    description: 'High-quality translation to Arabic with context awareness for natural reading',
    icon: 'languages',
  },
  {
    title: 'Text Overlay',
    description: 'Translated text displayed precisely over original speech bubbles',
    icon: 'layers',
  },
  {
    title: 'Instant Results',
    description: 'Smart caching ensures previously translated chapters load instantly',
    icon: 'zap',
  },
] as const;
