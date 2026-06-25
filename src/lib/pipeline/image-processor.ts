import sharp from 'sharp';
import { fetchImage } from './fetcher';
import { MAX_IMAGE_SIZE_BYTES, MAX_IMAGES_PER_CHAPTER } from '../constants';
import type { ParsedImage } from './parser';

export interface ProcessedImage {
  buffer: Buffer;
  base64: string;
  width: number;
  height: number;
  originalSrc: string;
  index: number;
  mimeType: string;
}

export async function processImage(imageUrl: string, index: number): Promise<ProcessedImage> {
  const rawBuffer = await fetchImage(imageUrl);

  if (rawBuffer.length > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(`Image too large: ${(rawBuffer.length / 1024 / 1024).toFixed(1)}MB (max ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB)`);
  }

  // Normalize to PNG for OCR compatibility
  const image = sharp(rawBuffer);
  const metadata = await image.metadata();

  const processedBuffer = await image
    .png({ quality: 90 })
    .toBuffer();

  const base64 = `data:image/png;base64,${processedBuffer.toString('base64')}`;

  return {
    buffer: processedBuffer,
    base64,
    width: metadata.width || 0,
    height: metadata.height || 0,
    originalSrc: imageUrl,
    index,
    mimeType: 'image/png',
  };
}

export async function processImages(
  parsedImages: ParsedImage[]
): Promise<ProcessedImage[]> {
  const limitedImages = parsedImages.slice(0, MAX_IMAGES_PER_CHAPTER);
  const results: ProcessedImage[] = [];

  // Process sequentially to manage memory
  for (const img of limitedImages) {
    try {
      const processed = await processImage(img.src, img.index);
      results.push(processed);
    } catch (error) {
      console.error(`[ImageProcessor] Failed for ${img.src}:`, error);
      // Skip failed images
    }
  }

  return results;
}
