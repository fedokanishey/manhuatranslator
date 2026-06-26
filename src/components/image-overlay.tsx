'use client';

import { useState, useEffect } from 'react';
import type { TextOverlay } from '@/types/translation';

interface ImageOverlayProps {
  overlays: TextOverlay[];
  imageWidth: number;
  imageHeight: number;
  imageBase64: string;
}

export function ImageOverlay({ overlays, imageWidth, imageHeight, imageBase64 }: ImageOverlayProps) {
  const [bgColors, setBgColors] = useState<string[]>([]);

  useEffect(() => {
    if (overlays.length === 0 || !imageBase64) return;

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      ctx.drawImage(img, 0, 0);

      const colors = overlays.map((overlay) =>
        sampleBubbleColor(ctx, overlay.bbox, img.naturalWidth, img.naturalHeight)
      );

      setBgColors(colors);
    };
    img.src = imageBase64;
  }, [overlays, imageBase64, imageWidth, imageHeight]);

  if (overlays.length === 0) return null;

  return (
    <div className="text-overlay-container">
      {overlays.map((overlay, idx) => {
        // Keep a tiny 2% safety expansion to blend margins perfectly inside the bubble
        const expandX = Math.max(2, overlay.bbox.width * 0.02);
        const expandY = Math.max(2, overlay.bbox.height * 0.02);
        
        const adjX = Math.max(0, overlay.bbox.x - expandX);
        const adjY = Math.max(0, overlay.bbox.y - expandY);
        const adjW = overlay.bbox.width + expandX * 2;
        const adjH = overlay.bbox.height + expandY * 2;

        const left = (adjX / imageWidth) * 100;
        const top = (adjY / imageHeight) * 100;
        const width = (adjW / imageWidth) * 100;
        const height = (adjH / imageHeight) * 100;

        // Font size calculations based on adjusted bbox dimensions
        const textLength = overlay.translatedText.length;
        
        // Dynamic aspect-ratio based border-radius & padding for speech bubbles vs narrator boxes
        const aspectRatio = adjW / adjH;
        let borderRadius = '40%';
        let padding = '4px 8px';
        if (aspectRatio >= 0.5 && aspectRatio <= 2.0) {
          borderRadius = '50%'; // Oval/ellipse shape for standard speech bubbles
          padding = '8% 12%'; // Higher padding to keep text inside the oval area
        } else {
          borderRadius = '8px'; // Narrator box / rectangular shape
          padding = '4px 8px';
        }

        // Estimate lines and character width to set optimal font size
        const estimatedLines = Math.max(1, Math.ceil(textLength / 12));
        const heightBasedFontSize = (overlay.bbox.height / estimatedLines) * 0.85;
        const avgCharsPerLine = Math.max(4, textLength / estimatedLines);
        const widthBasedFontSize = (overlay.bbox.width / avgCharsPerLine) * 1.6;
        
        let fontSizePx = Math.min(heightBasedFontSize, widthBasedFontSize);
        fontSizePx = Math.max(10, Math.min(fontSizePx, 22));
        const fontSizeCqw = (fontSizePx / imageWidth) * 100;

        const bgColor = bgColors[idx] || 'rgb(255, 255, 255)';

        return (
          <div
            key={`overlay-${idx}`}
            className="text-overlay-box"
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: `${width}%`,
              height: `${height}%`,
              fontSize: `clamp(11px, ${fontSizeCqw}cqw, 24px)`,
              backgroundColor: bgColor,
              borderRadius: borderRadius,
              padding: padding,
            }}
            title={`Original: ${overlay.originalText}`}
          >
            {overlay.translatedText}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Samples the bubble background color by reading a dense grid of pixels
 * inside the bbox, filtering out dark pixels (text/outlines),
 * and finding the most common color.
 */
function sampleBubbleColor(
  ctx: CanvasRenderingContext2D,
  bbox: { x: number; y: number; width: number; height: number },
  imgWidth: number,
  imgHeight: number
): string {
  const samples: [number, number, number][] = [];
  const steps = 5;

  for (let row = 0; row < steps; row++) {
    for (let col = 0; col < steps; col++) {
      const px = bbox.x + bbox.width * ((col + 0.5) / steps);
      const py = bbox.y + bbox.height * ((row + 0.5) / steps);

      const x = Math.max(0, Math.min(Math.round(px), imgWidth - 1));
      const y = Math.max(0, Math.min(Math.round(py), imgHeight - 1));
      const pixel = ctx.getImageData(x, y, 1, 1).data;
      samples.push([pixel[0], pixel[1], pixel[2]]);
    }
  }

  // Filter out dark pixels (text, outlines)
  const lightSamples = samples.filter(([r, g, b]) => {
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    return luminance > 120;
  });

  const finalSamples = lightSamples.length >= 3 ? lightSamples : samples;

  // Find most common color (8-step quantized buckets)
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
    return `rgb(${Math.round(best.r / best.count)}, ${Math.round(best.g / best.count)}, ${Math.round(best.b / best.count)})`;
  }

  return 'rgb(255, 255, 255)';
}
