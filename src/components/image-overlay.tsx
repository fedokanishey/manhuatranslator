'use client';

import type { TextOverlay } from '@/types/translation';
import { TRANSLATABLE_TEXT_TYPES, OPTIONAL_TEXT_TYPES } from '@/types/translation';
import { ARABIC_LINE_HEIGHT_RATIO } from '@/lib/constants';

interface ImageOverlayProps {
  overlays: TextOverlay[];
  imageWidth: number;
  imageHeight: number;
}

/**
 * Renders Arabic text overlays on top of an inpainted manga image.
 * 
 * Key differences from the old implementation:
 * - Background is transparent (inpainting already removed original text)
 * - Font size and line breaks are computed server-side by the layout engine
 * - Elliptical bubbles use clip-path to prevent overflow
 * - Proper RTL rendering with Arabic font
 * - Never renders outside bubble boundaries
 */
export function ImageOverlay({ overlays, imageWidth, imageHeight }: ImageOverlayProps) {
  // Filter to only show translatable overlays
  const visibleOverlays = overlays.filter((o) => {
    if (!o.textType) return true; // Legacy overlays without classification
    return TRANSLATABLE_TEXT_TYPES.includes(o.textType) || OPTIONAL_TEXT_TYPES.includes(o.textType);
  });

  if (visibleOverlays.length === 0) return null;

  return (
    <div className="text-overlay-container">
      {visibleOverlays.map((overlay, idx) => {
        if (!overlay.translatedText || overlay.translatedText.trim().length === 0) {
          return null;
        }

        const layout = overlay.layoutResult;
        const shape = overlay.bubblePolygon?.shape || 'rectangle';

        // Position as percentage of image dimensions
        const left = (overlay.bbox.x / imageWidth) * 100;
        const top = (overlay.bbox.y / imageHeight) * 100;
        const width = (overlay.bbox.width / imageWidth) * 100;
        const height = (overlay.bbox.height / imageHeight) * 100;

        // Font size: convert from absolute pixels to container-query-relative units
        const fontSize = layout?.fontSize || 14;
        const fontSizeCqw = (fontSize / imageWidth) * 100;

        // Line height
        const lineHeight = ARABIC_LINE_HEIGHT_RATIO;

        // Clip path for elliptical bubbles (prevents text overflow)
        const clipPath = shape === 'ellipse'
          ? 'ellipse(50% 50% at 50% 50%)'
          : shape === 'cloud'
            ? 'ellipse(48% 48% at 50% 50%)'
            : undefined;

        // Determine overlay CSS class
        const shapeClass = shape === 'ellipse'
          ? 'text-overlay-ellipse'
          : shape === 'cloud'
            ? 'text-overlay-cloud'
            : shape === 'rectangle'
              ? 'text-overlay-narration'
              : 'text-overlay-irregular';

        return (
          <div
            key={`overlay-${idx}`}
            className={`text-overlay-box ${shapeClass}`}
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: `${width}%`,
              height: `${height}%`,
              fontSize: `clamp(${Math.max(8, fontSize * 0.6)}px, ${fontSizeCqw}cqw, ${Math.min(36, fontSize * 1.3)}px)`,
              lineHeight: lineHeight,
              clipPath,
            }}
            title={`Original: ${overlay.originalText}`}
          >
            <div className="text-overlay-inner">
              {layout?.lines ? (
                layout.lines.map((line, lineIdx) => (
                  <span key={lineIdx} className="text-overlay-line">
                    {line}
                  </span>
                ))
              ) : (
                <span className="text-overlay-line">{overlay.translatedText}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
