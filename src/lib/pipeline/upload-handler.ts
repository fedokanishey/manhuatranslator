import sharp from 'sharp';
import { MAX_UPLOAD_SIZE_BYTES, MAX_IMAGES_PER_CHAPTER, MAX_IMAGE_SIZE_BYTES } from '../constants';
import type { UploadedImage } from '@/types/translation';
import type { ProcessedImage } from './image-processor';

const VALID_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
];

const VALID_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

/**
 * Handle uploaded image files and convert them to ProcessedImage format.
 */
export async function processUploadedImages(
  files: Array<{ name: string; buffer: Buffer; type: string }>
): Promise<ProcessedImage[]> {
  // Validate total size
  const totalSize = files.reduce((sum, f) => sum + f.buffer.length, 0);
  if (totalSize > MAX_UPLOAD_SIZE_BYTES) {
    throw new Error(
      `Total upload size (${(totalSize / 1024 / 1024).toFixed(1)}MB) exceeds limit (${MAX_UPLOAD_SIZE_BYTES / 1024 / 1024}MB)`
    );
  }

  // Separate ZIP files from images
  const zipFiles = files.filter((f) => isZipFile(f.name, f.type));
  const imageFiles = files.filter((f) => !isZipFile(f.name, f.type));

  // Extract images from ZIP files
  let extractedImages: Array<{ name: string; buffer: Buffer; type: string }> = [];
  for (const zip of zipFiles) {
    const extracted = await extractImagesFromZip(zip.buffer);
    extractedImages = extractedImages.concat(extracted);
  }

  // Combine and sort all images
  const allImages = [...imageFiles, ...extractedImages]
    .filter((f) => isImageFile(f.name, f.type))
    .sort((a, b) => naturalSort(a.name, b.name));

  // Limit number of images
  const limitedImages = allImages.slice(0, MAX_IMAGES_PER_CHAPTER);

  console.log(`[Upload] Processing ${limitedImages.length} images (from ${files.length} uploaded files)`);

  // Process each image
  const results: ProcessedImage[] = [];
  for (let i = 0; i < limitedImages.length; i++) {
    const img = limitedImages[i];
    try {
      if (img.buffer.length > MAX_IMAGE_SIZE_BYTES) {
        console.warn(`[Upload] Skipping ${img.name}: too large (${(img.buffer.length / 1024 / 1024).toFixed(1)}MB)`);
        continue;
      }

      const image = sharp(img.buffer);
      const metadata = await image.metadata();

      const processedBuffer = await image.png({ quality: 90 }).toBuffer();
      const base64 = `data:image/png;base64,${processedBuffer.toString('base64')}`;

      results.push({
        buffer: processedBuffer,
        base64,
        width: metadata.width || 0,
        height: metadata.height || 0,
        originalSrc: `upload://${img.name}`,
        index: i,
        mimeType: 'image/png',
      });
    } catch (error) {
      console.error(`[Upload] Failed to process ${img.name}:`, error);
    }
  }

  if (results.length === 0) {
    throw new Error('No valid images found in the uploaded files');
  }

  return results;
}

/**
 * Extract image files from a ZIP archive.
 * Uses the built-in DecompressionStream API (Node 18+).
 */
async function extractImagesFromZip(
  zipBuffer: Buffer
): Promise<Array<{ name: string; buffer: Buffer; type: string }>> {
  const images: Array<{ name: string; buffer: Buffer; type: string }> = [];

  try {
    // Use a lightweight ZIP parser (manual parsing of ZIP local file headers)
    let offset = 0;
    const view = new DataView(zipBuffer.buffer, zipBuffer.byteOffset, zipBuffer.byteLength);

    while (offset < zipBuffer.length - 4) {
      // Local file header signature: 0x04034b50
      const sig = view.getUint32(offset, true);
      if (sig !== 0x04034b50) break;

      const compressionMethod = view.getUint16(offset + 8, true);
      const compressedSize = view.getUint32(offset + 18, true);
      const uncompressedSize = view.getUint32(offset + 22, true);
      const nameLength = view.getUint16(offset + 26, true);
      const extraLength = view.getUint16(offset + 28, true);

      const nameStart = offset + 30;
      const name = zipBuffer.subarray(nameStart, nameStart + nameLength).toString('utf-8');

      const dataStart = nameStart + nameLength + extraLength;
      const dataEnd = dataStart + compressedSize;

      // Only process uncompressed image files (method 0 = stored)
      if (compressionMethod === 0 && isImageFile(name, '') && uncompressedSize > 0) {
        const fileData = Buffer.from(zipBuffer.subarray(dataStart, dataEnd));
        const ext = name.split('.').pop()?.toLowerCase() || '';
        const mimeType = ext === 'png' ? 'image/png' :
                         ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
                         ext === 'webp' ? 'image/webp' :
                         ext === 'gif' ? 'image/gif' : 'image/png';

        images.push({ name, buffer: fileData, type: mimeType });
      } else if (compressionMethod === 8 && isImageFile(name, '') && compressedSize > 0) {
        // Deflate compressed — use DecompressionStream
        try {
          const compressedData = zipBuffer.subarray(dataStart, dataEnd);
          const ds = new DecompressionStream('deflate-raw');
          const writer = ds.writable.getWriter();
          const reader = ds.readable.getReader();

          writer.write(new Uint8Array(compressedData));
          writer.close();


          const chunks: Uint8Array[] = [];
          let done = false;
          while (!done) {
            const { value, done: readerDone } = await reader.read();
            if (value) chunks.push(value);
            done = readerDone;
          }

          const decompressed = Buffer.concat(chunks);
          const ext = name.split('.').pop()?.toLowerCase() || '';
          const mimeType = ext === 'png' ? 'image/png' :
                           ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
                           ext === 'webp' ? 'image/webp' : 'image/png';

          images.push({ name, buffer: decompressed, type: mimeType });
        } catch (e) {
          console.warn(`[Upload] Failed to decompress ${name}:`, e);
        }
      }

      offset = dataEnd;
    }
  } catch (error) {
    console.error('[Upload] ZIP extraction failed:', error);
    throw new Error('Failed to extract images from ZIP file. Please upload images individually.');
  }

  console.log(`[Upload] Extracted ${images.length} images from ZIP`);
  return images;
}

// ── Helpers ──────────────────────────────────────────────────────────

function isZipFile(name: string, type: string): boolean {
  return (
    type === 'application/zip' ||
    type === 'application/x-zip-compressed' ||
    name.toLowerCase().endsWith('.zip')
  );
}

function isImageFile(name: string, type: string): boolean {
  if (VALID_IMAGE_TYPES.includes(type)) return true;
  const lower = name.toLowerCase();
  // Skip hidden files and macOS metadata
  if (lower.includes('__macosx') || lower.startsWith('.')) return false;
  return VALID_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Natural sort for filenames (e.g., "page2" before "page10").
 */
function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
