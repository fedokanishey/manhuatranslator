import sharp, { OverlayOptions } from 'sharp';
import type { TextOverlay, BoundingBox, InpaintedRegion, BubbleShape } from '@/types/translation';
import { TRANSLATABLE_TEXT_TYPES } from '@/types/translation';


/**
 * Inpainting Engine
 * 
 * Removes original text from manga images by filling text regions with
 * the dominant bubble background color. Uses edge-pixel sampling to
 * determine fill color and applies smooth blending.
 */

export interface InpaintingResult {
  /** The inpainted image buffer (PNG) */
  buffer: Buffer;
  /** Base64 data URI of the inpainted image */
  base64: string;
  /** Regions that were inpainted */
  regions: InpaintedRegion[];
}

/**
 * Inpaint all translatable text regions from an image.
 * Only inpaints overlays classified as translatable (speech_bubble, narration_box).
 */
export async function inpaintImage(
  imageBuffer: Buffer,
  overlays: TextOverlay[],
  imageWidth: number,
  imageHeight: number
): Promise<InpaintingResult> {
  // Filter to only translatable text types that need inpainting
  const toInpaint = overlays.filter(
    (o) => !o.textType || TRANSLATABLE_TEXT_TYPES.includes(o.textType)
  );

  if (toInpaint.length === 0) {
    const base64 = `data:image/png;base64,${imageBuffer.toString('base64')}`;
    return { buffer: imageBuffer, base64, regions: [] };
  }

  // Sample fill colors for each region from the original image
  const fillInfos = await sampleFillColors(imageBuffer, toInpaint, imageWidth, imageHeight);

  // Build composite overlays (SVG-based fills)
  const compositeInputs: OverlayOptions[] = [];
  const regions: InpaintedRegion[] = [];


  for (let i = 0; i < toInpaint.length; i++) {
    const overlay = toInpaint[i];
    const fillColor = fillInfos[i];
    const shape = overlay.bubblePolygon?.shape || 'rectangle';

    // Clamp bbox to image bounds
    const bbox = clampBbox(overlay.bbox, imageWidth, imageHeight);
    if (bbox.width <= 0 || bbox.height <= 0) continue;

    // Create the fill SVG
    const fillSvg = createFillSvg(bbox, shape, fillColor);

    compositeInputs.push({
      input: Buffer.from(fillSvg),
      top: bbox.y,
      left: bbox.x,
    });

    regions.push({
      bbox,
      fillColor,
      shape,
    });
  }

  // Apply all fills as a single composite operation
  let result: Buffer;
  if (compositeInputs.length > 0) {
    result = await sharp(imageBuffer)
      .composite(compositeInputs)
      .png()
      .toBuffer();
  } else {
    result = imageBuffer;
  }

  const base64 = `data:image/png;base64,${result.toString('base64')}`;

  console.log(`[Inpainter] Inpainted ${regions.length} regions`);

  return { buffer: result, base64, regions };
}

/**
 * Sample the dominant background color for each overlay region
 * by reading pixels around the edges of the bounding box.
 */
async function sampleFillColors(
  imageBuffer: Buffer,
  overlays: TextOverlay[],
  imageWidth: number,
  imageHeight: number
): Promise<string[]> {
  // Extract raw pixel data
  const { data: pixels, info } = await sharp(imageBuffer)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const width = info.width;

  return overlays.map((overlay) => {
    const bbox = clampBbox(overlay.bbox, imageWidth, imageHeight);
    return sampleRegionColor(pixels, width, channels, bbox);
  });
}

/**
 * Sample the dominant color from the border pixels of a region.
 * Filters out dark pixels (text/outlines) to find the actual background.
 */
function sampleRegionColor(
  pixels: Buffer,
  imgWidth: number,
  channels: number,
  bbox: BoundingBox
): string {
  const samples: [number, number, number][] = [];

  // Sample from 4 edges of the bbox (inset by 2px to avoid border artifacts)
  const inset = 2;
  const x1 = Math.max(0, bbox.x + inset);
  const y1 = Math.max(0, bbox.y + inset);
  const x2 = Math.min(imgWidth - 1, bbox.x + bbox.width - inset);
  const y2 = bbox.y + bbox.height - inset;
  const steps = 8;

  // Top edge
  for (let i = 0; i < steps; i++) {
    const px = Math.round(x1 + (x2 - x1) * (i / (steps - 1)));
    addPixelSample(pixels, imgWidth, channels, px, y1, samples);
  }

  // Bottom edge
  for (let i = 0; i < steps; i++) {
    const px = Math.round(x1 + (x2 - x1) * (i / (steps - 1)));
    addPixelSample(pixels, imgWidth, channels, px, Math.min(y2, bbox.y + bbox.height - 1), samples);
  }

  // Left edge
  for (let i = 0; i < steps; i++) {
    const py = Math.round(y1 + (y2 - y1) * (i / (steps - 1)));
    addPixelSample(pixels, imgWidth, channels, x1, py, samples);
  }

  // Right edge
  for (let i = 0; i < steps; i++) {
    const py = Math.round(y1 + (y2 - y1) * (i / (steps - 1)));
    addPixelSample(pixels, imgWidth, channels, x2, py, samples);
  }

  // Also sample center area (5x5 grid) to catch solid fills
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const px = Math.round(bbox.x + bbox.width * ((col + 0.5) / 5));
      const py = Math.round(bbox.y + bbox.height * ((row + 0.5) / 5));
      addPixelSample(pixels, imgWidth, channels, px, py, samples);
    }
  }

  // Filter out dark pixels (text, outlines)
  const lightSamples = samples.filter(([r, g, b]) => {
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    return luminance > 120;
  });

  const finalSamples = lightSamples.length >= 3 ? lightSamples : samples;

  // Find most common color using quantized buckets
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (const [r, g, b] of finalSamples) {
    const key = `${Math.round(r / 8) * 8},${Math.round(g / 8) * 8},${Math.round(b / 8) * 8}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count++;
      existing.r += r;
      existing.g += g;
      existing.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }

  let best = { count: 0, r: 255, g: 255, b: 255 };
  for (const bucket of buckets.values()) {
    if (bucket.count > best.count) {
      best = bucket;
    }
  }

  if (best.count > 0) {
    const r = Math.round(best.r / best.count);
    const g = Math.round(best.g / best.count);
    const b = Math.round(best.b / best.count);
    return `rgb(${r}, ${g}, ${b})`;
  }

  return 'rgb(255, 255, 255)';
}

function addPixelSample(
  pixels: Buffer,
  imgWidth: number,
  channels: number,
  x: number,
  y: number,
  samples: [number, number, number][]
): void {
  const idx = (y * imgWidth + x) * channels;
  if (idx >= 0 && idx + 2 < pixels.length) {
    samples.push([pixels[idx], pixels[idx + 1], pixels[idx + 2]]);
  }
}

/**
 * Create an SVG that fills the region with the specified color and shape.
 * Uses a feather/blur at edges for smooth blending.
 */
function createFillSvg(
  bbox: BoundingBox,
  shape: BubbleShape,
  fillColor: string
): string {
  const w = bbox.width;
  const h = bbox.height;

  // Parse RGB values from the fillColor string
  const rgbMatch = fillColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  const r = rgbMatch ? rgbMatch[1] : '255';
  const g = rgbMatch ? rgbMatch[2] : '255';
  const b = rgbMatch ? rgbMatch[3] : '255';
  const hexColor = `#${parseInt(r).toString(16).padStart(2, '0')}${parseInt(g).toString(16).padStart(2, '0')}${parseInt(b).toString(16).padStart(2, '0')}`;

  // Feather radius for edge blending (proportional to size)
  const feather = Math.max(1, Math.min(4, Math.round(Math.min(w, h) * 0.05)));

  if (shape === 'ellipse') {
    // Elliptical fill for oval speech bubbles
    const cx = w / 2;
    const cy = h / 2;
    const rx = w / 2 - 1;
    const ry = h / 2 - 1;

    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="blur"><feGaussianBlur stdDeviation="${feather}"/></filter>
      </defs>
      <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${hexColor}" filter="url(#blur)"/>
      <ellipse cx="${cx}" cy="${cy}" rx="${rx - feather}" ry="${ry - feather}" fill="${hexColor}"/>
    </svg>`;
  }

  if (shape === 'cloud') {
    // Cloud shape: rounded rectangle with extra large border radius
    const radius = Math.min(w, h) * 0.3;
    return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="blur"><feGaussianBlur stdDeviation="${feather}"/></filter>
      </defs>
      <rect x="0" y="0" width="${w}" height="${h}" rx="${radius}" ry="${radius}" fill="${hexColor}" filter="url(#blur)"/>
      <rect x="${feather}" y="${feather}" width="${w - feather * 2}" height="${h - feather * 2}" rx="${radius}" ry="${radius}" fill="${hexColor}"/>
    </svg>`;
  }

  // Default: rectangle with slight rounding and edge blur
  const radius = Math.min(4, Math.min(w, h) * 0.05);
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="blur"><feGaussianBlur stdDeviation="${feather}"/></filter>
    </defs>
    <rect x="0" y="0" width="${w}" height="${h}" rx="${radius}" ry="${radius}" fill="${hexColor}" filter="url(#blur)"/>
    <rect x="${feather}" y="${feather}" width="${w - feather * 2}" height="${h - feather * 2}" rx="${radius}" ry="${radius}" fill="${hexColor}"/>
  </svg>`;
}

/**
 * Clamp a bounding box to stay within image bounds.
 */
function clampBbox(bbox: BoundingBox, imgWidth: number, imgHeight: number): BoundingBox {
  const x = Math.max(0, Math.round(bbox.x));
  const y = Math.max(0, Math.round(bbox.y));
  const width = Math.min(Math.round(bbox.width), imgWidth - x);
  const height = Math.min(Math.round(bbox.height), imgHeight - y);
  return { x, y, width, height };
}
