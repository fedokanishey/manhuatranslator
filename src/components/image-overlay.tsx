'use client';

import type { TextOverlay } from '@/types/translation';

interface ImageOverlayProps {
  overlays: TextOverlay[];
  imageWidth: number;
  imageHeight: number;
}

export function ImageOverlay({ overlays, imageWidth, imageHeight }: ImageOverlayProps) {
  if (overlays.length === 0) return null;

  return (
    <div className="text-overlay-container">
      {overlays.map((overlay, idx) => {
        // Calculate percentage positions relative to image dimensions
        const left = (overlay.bbox.x / imageWidth) * 100;
        const top = (overlay.bbox.y / imageHeight) * 100;
        const width = (overlay.bbox.width / imageWidth) * 100;
        const height = (overlay.bbox.height / imageHeight) * 100;

        const textLength = overlay.translatedText.length;
        const boxWidth = overlay.bbox.width;
        const boxHeight = overlay.bbox.height;

        // Heuristic: Estimate the number of lines.
        // Arabic characters need a bit more spacing. Assume ~12 characters per line.
        const estimatedLines = Math.max(1, Math.ceil(textLength / 12));
        
        // Font size based on height: height divided by estimated number of lines, with a scaling factor
        const heightBasedFontSize = (boxHeight / estimatedLines) * 0.8;
        
        // Font size based on width: boxWidth divided by average characters per line, with a scale factor
        const avgCharsPerLine = Math.max(4, textLength / estimatedLines);
        const widthBasedFontSize = (boxWidth / avgCharsPerLine) * 1.3;
        
        // Take the minimum to ensure it fits in both directions, and clamp within safe bounds
        let fontSizePx = Math.min(heightBasedFontSize, widthBasedFontSize);
        fontSizePx = Math.max(11, Math.min(fontSizePx, 22)); // Max 22px in image space to keep it clean

        // Convert to cqw relative to imageWidth so it scales when the reader is resized
        const fontSizeCqw = (fontSizePx / imageWidth) * 100;

        return (
          <div
            key={`overlay-${idx}`}
            className="text-overlay-box"
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: `${width}%`,
              height: `${height}%`,
              fontSize: `clamp(10px, ${fontSizeCqw}cqw, 24px)`,
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
