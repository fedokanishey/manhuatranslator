import * as cheerio from 'cheerio';
import type { ContentType } from '@/types/translation';

export interface ParsedContent {
  title: string;
  contentType: ContentType;
  images: ParsedImage[];
  textBlocks: ParsedTextBlock[];
  metadata: PageMetadata;
}

export interface ParsedImage {
  src: string;
  alt: string;
  index: number;
  width?: number;
  height?: number;
}

export interface ParsedTextBlock {
  text: string;
  selector: string;
  tagName: string;
  index: number;
}

export interface PageMetadata {
  title: string;
  description: string;
  language: string;
  siteName: string;
}

// Selectors to exclude from text extraction
const EXCLUDED_SELECTORS = [
  'script', 'style', 'noscript', 'iframe',
  'nav', 'footer', 'header',
  '.ads', '.ad', '.advertisement', '[class*="ad-"]',
  '.navigation', '.menu', '.sidebar',
  '.comment', '.comments', '#comments',
  '.social-share', '.share-buttons',
  '.cookie-banner', '.popup',
];

// Common manga/manhwa image container selectors
const IMAGE_CONTAINER_SELECTORS = [
  '.reading-content img',
  '.chapter-content img',
  '.entry-content img',
  '.comic-page img',
  '.page-break img',
  '#readerarea img',
  '.container-chapter-reader img',
  '.reading-detail img',
  '.chapter-img img',
  '.vung-doc img',
  '.chapter_img img',
  'article img',
  '.content img',
  'main img',
];

export function parseHtml(html: string, sourceUrl: string): ParsedContent {
  const $ = cheerio.load(html);
  const baseUrl = new URL(sourceUrl).origin;

  // Extract metadata
  const metadata = extractMetadata($, baseUrl);

  // Remove unwanted elements
  EXCLUDED_SELECTORS.forEach((sel) => $(sel).remove());

  // Extract images (prioritize manga-specific containers)
  const images = extractImages($, baseUrl, sourceUrl);

  // Extract text blocks
  const textBlocks = extractTextBlocks($);

  // Determine content type
  const contentType = determineContentType(images, textBlocks);

  return {
    title: metadata.title,
    contentType,
    images,
    textBlocks,
    metadata,
  };
}

function extractMetadata($: cheerio.CheerioAPI, baseUrl: string): PageMetadata {
  const title =
    $('meta[property="og:title"]').attr('content') ||
    $('title').text() ||
    $('h1').first().text() ||
    'Untitled Chapter';

  const description =
    $('meta[property="og:description"]').attr('content') ||
    $('meta[name="description"]').attr('content') ||
    '';

  const language =
    $('html').attr('lang') || 
    $('meta[http-equiv="content-language"]').attr('content') || 
    'unknown';

  const siteName =
    $('meta[property="og:site_name"]').attr('content') ||
    new URL(baseUrl).hostname;

  return {
    title: title.trim(),
    description: description.trim(),
    language: language.trim(),
    siteName: siteName.trim(),
  };
}

function extractImages($: cheerio.CheerioAPI, baseUrl: string, sourceUrl: string): ParsedImage[] {
  const images: ParsedImage[] = [];
  const seenSrcs = new Set<string>();

  // Try manga-specific selectors first
  let imgElements: cheerio.Cheerio<any> = $([]);
  for (const selector of IMAGE_CONTAINER_SELECTORS) {
    const found = $(selector);
    if (found.length > 0) {
      imgElements = found;
      break;
    }
  }

  // Fall back to all images if none found with specific selectors
  if (imgElements.length === 0) {
    imgElements = $('img');
  }

  imgElements.each((index, el) => {
    const $el = $(el);
    const src = $el.attr('data-src') || $el.attr('data-lazy-src') || $el.attr('src') || '';
    
    if (!src || src.startsWith('data:image/svg') || src.includes('logo') || src.includes('icon')) {
      return;
    }

    const resolvedSrc = resolveUrl(src, baseUrl, sourceUrl);
    if (seenSrcs.has(resolvedSrc)) return;
    seenSrcs.add(resolvedSrc);

    const width = parseInt($el.attr('width') || '0', 10) || undefined;
    const height = parseInt($el.attr('height') || '0', 10) || undefined;

    // Filter out tiny images (likely icons/buttons)
    if (width && width < 100) return;
    if (height && height < 100) return;

    images.push({
      src: resolvedSrc,
      alt: $el.attr('alt') || '',
      index,
      width,
      height,
    });
  });

  return images;
}

function extractTextBlocks($: cheerio.CheerioAPI): ParsedTextBlock[] {
  const blocks: ParsedTextBlock[] = [];
  const textTags = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'blockquote', 'figcaption'];

  textTags.forEach((tag) => {
    $(tag).each((index, el) => {
      const $el = $(el);
      const text = $el.text().trim();
      
      if (text.length < 2) return;

      blocks.push({
        text,
        selector: `${tag}:nth-of-type(${index + 1})`,
        tagName: tag,
        index: blocks.length,
      });
    });
  });

  return blocks;
}

function determineContentType(images: ParsedImage[], textBlocks: ParsedTextBlock[]): ContentType {
  const hasImages = images.length > 0;
  const hasText = textBlocks.some((b) => b.text.length > 20); // Meaningful text

  if (hasImages && hasText) return 'mixed';
  if (hasImages) return 'image';
  return 'text';
}

function resolveUrl(src: string, baseUrl: string, pageUrl: string): string {
  try {
    if (src.startsWith('http://') || src.startsWith('https://')) {
      return src;
    }
    if (src.startsWith('//')) {
      return `https:${src}`;
    }
    if (src.startsWith('/')) {
      return `${baseUrl}${src}`;
    }
    // Relative URL
    const pageBase = pageUrl.substring(0, pageUrl.lastIndexOf('/') + 1);
    return `${pageBase}${src}`;
  } catch {
    return src;
  }
}
