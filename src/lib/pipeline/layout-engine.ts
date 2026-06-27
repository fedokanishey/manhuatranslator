import type { BoundingBox, LayoutResult, BubbleShape } from '@/types/translation';
import {
  MAX_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  DEFAULT_FONT_WEIGHT,
  ARABIC_CHAR_WIDTH_RATIO,
  ARABIC_LINE_HEIGHT_RATIO,
} from '../constants';

/**
 * Arabic Layout Engine
 * 
 * Computes optimal font size, line breaks, and positioning for Arabic text
 * to fit perfectly inside manga speech bubbles of various shapes.
 * 
 * Algorithm:
 * 1. Determine usable region (shrink for ellipse/cloud shapes)
 * 2. Binary search for largest font size where text fits
 * 3. Balance line lengths for visual symmetry
 * 4. Center horizontally and vertically
 */

export function computeLayout(
  bbox: BoundingBox,
  text: string,
  shape: BubbleShape = 'rectangle',
  isVertical: boolean = false
): LayoutResult {
  if (!text || text.trim().length === 0) {
    return {
      fontSize: MIN_FONT_SIZE_PX,
      lines: [''],
      totalHeight: 0,
      offsetX: 0,
      offsetY: 0,
      usableWidth: bbox.width,
      fontWeight: DEFAULT_FONT_WEIGHT,
    };
  }

  const trimmedText = text.trim();

  // Determine usable area based on bubble shape
  const usable = getUsableArea(bbox, shape);

  // For vertical (originally vertical CJK text) — use compact layout
  if (isVertical) {
    return computeCompactLayout(usable, trimmedText, bbox);
  }

  // Binary search for optimal font size
  let bestResult: LayoutResult | null = null;
  let lo = MIN_FONT_SIZE_PX;
  let hi = Math.min(MAX_FONT_SIZE_PX, usable.height * 0.8);

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const result = tryLayout(usable, trimmedText, mid, bbox, shape);

    if (result) {
      bestResult = result;
      lo = mid + 1; // Try larger
    } else {
      hi = mid - 1; // Too big, shrink
    }
  }

  // If binary search found nothing, force minimum size
  if (!bestResult) {
    bestResult = tryLayout(usable, trimmedText, MIN_FONT_SIZE_PX, bbox, shape) ||
      createFallbackLayout(usable, trimmedText, bbox);
  }

  return bestResult;
}

/**
 * Compute usable text area within a bubble shape.
 * For ellipses, inscribe a rectangle. For cloud shapes, add extra padding.
 */
interface UsableArea {
  x: number;
  y: number;
  width: number;
  height: number;
  /** For ellipse shapes: function to get usable width at a given y-offset from center */
  getWidthAtOffset?: (yOffset: number, totalHeight: number) => number;
}

function getUsableArea(bbox: BoundingBox, shape: BubbleShape): UsableArea {
  // Padding as percentage of dimensions
  const padX = bbox.width * 0.08;
  const padY = bbox.height * 0.08;

  if (shape === 'ellipse') {
    // Inscribed rectangle of an ellipse: width factor ≈ 0.707 (1/√2)
    // But we use a slightly more generous factor and per-line width calculation
    const factor = 0.7;
    const usableW = bbox.width * factor;
    const usableH = bbox.height * factor;
    const cx = bbox.width / 2;
    const cy = bbox.height / 2;

    return {
      x: cx - usableW / 2,
      y: cy - usableH / 2,
      width: usableW,
      height: usableH,
      getWidthAtOffset: (yOffset: number, totalHeight: number) => {
        // For each line at yOffset from center, compute the ellipse width
        const ry = bbox.height / 2;
        const rx = bbox.width / 2;
        const normalizedY = yOffset / ry;
        const clampedY = Math.min(Math.abs(normalizedY), 0.95);
        // Ellipse equation: x²/rx² + y²/ry² = 1 → x = rx * √(1 - y²/ry²)
        const widthAtY = 2 * rx * Math.sqrt(1 - clampedY * clampedY);
        // Apply inner padding
        return Math.max(0, widthAtY * 0.85);
      },
    };
  }

  if (shape === 'cloud') {
    // Cloud bubbles have more irregular edges, use more padding
    const cloudPadX = bbox.width * 0.15;
    const cloudPadY = bbox.height * 0.15;
    return {
      x: cloudPadX,
      y: cloudPadY,
      width: bbox.width - cloudPadX * 2,
      height: bbox.height - cloudPadY * 2,
    };
  }

  // Rectangle / irregular — simple padding
  return {
    x: padX,
    y: padY,
    width: bbox.width - padX * 2,
    height: bbox.height - padY * 2,
  };
}

/**
 * Try to layout text at a given font size.
 * Returns LayoutResult if text fits, null if it doesn't.
 */
function tryLayout(
  usable: UsableArea,
  text: string,
  fontSize: number,
  bbox: BoundingBox,
  shape: BubbleShape
): LayoutResult | null {
  const charWidth = fontSize * ARABIC_CHAR_WIDTH_RATIO;
  const lineHeight = fontSize * ARABIC_LINE_HEIGHT_RATIO;

  // Wrap text into lines
  const lines = wrapText(text, usable, fontSize, shape);

  // Calculate total height
  const totalHeight = lines.length * lineHeight;

  // Check if it fits vertically
  if (totalHeight > usable.height) {
    return null;
  }

  // Check if all lines fit horizontally
  for (let i = 0; i < lines.length; i++) {
    const lineWidth = estimateTextWidth(lines[i], fontSize);
    let maxWidth = usable.width;

    if (usable.getWidthAtOffset && shape === 'ellipse') {
      // For ellipse, check width at this line's vertical position
      const lineY = -totalHeight / 2 + i * lineHeight + lineHeight / 2;
      maxWidth = usable.getWidthAtOffset(lineY, totalHeight);
    }

    if (lineWidth > maxWidth) {
      return null;
    }
  }

  // Calculate centering offsets (relative to bbox)
  const offsetX = bbox.width / 2; // Center horizontally (text-align: center handles this)
  const offsetY = (bbox.height - totalHeight) / 2; // Vertical centering

  return {
    fontSize,
    lines,
    totalHeight,
    offsetX,
    offsetY: Math.max(0, offsetY),
    usableWidth: usable.width,
    fontWeight: DEFAULT_FONT_WEIGHT,
  };
}

/**
 * Wrap Arabic text into balanced lines that fit the available width.
 */
function wrapText(
  text: string,
  usable: UsableArea,
  fontSize: number,
  shape: BubbleShape
): string[] {
  const words = text.split(/\s+/);
  if (words.length === 0) return [''];

  // Try fitting in a single line first
  const singleLineWidth = estimateTextWidth(text, fontSize);
  if (singleLineWidth <= usable.width) {
    return [text];
  }

  // Greedy line wrapping
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = estimateTextWidth(testLine, fontSize);

    let maxWidth = usable.width;
    if (usable.getWidthAtOffset && shape === 'ellipse') {
      // Estimate which line number this would be and get width
      const lineIdx = lines.length;
      const lineHeight = fontSize * ARABIC_LINE_HEIGHT_RATIO;
      const estimatedTotalLines = Math.ceil(words.length / Math.max(1, Math.floor(usable.width / (fontSize * ARABIC_CHAR_WIDTH_RATIO * 3))));
      const totalHeight = estimatedTotalLines * lineHeight;
      const lineY = -totalHeight / 2 + lineIdx * lineHeight + lineHeight / 2;
      maxWidth = usable.getWidthAtOffset(lineY, totalHeight);
    }

    if (testWidth <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  // Balance lines: if we have multiple lines, try to make them roughly equal length
  if (lines.length >= 2 && lines.length <= 5) {
    return balanceLines(words, lines.length, usable.width, fontSize);
  }

  return lines;
}

/**
 * Balance line lengths for visual symmetry.
 * Distributes words across N lines to minimize the difference between
 * the longest and shortest lines.
 */
function balanceLines(
  words: string[],
  targetLineCount: number,
  maxWidth: number,
  fontSize: number
): string[] {
  const totalLength = words.reduce((sum, w) => sum + w.length, 0);
  const avgCharsPerLine = Math.ceil(totalLength / targetLineCount);

  const lines: string[] = [];
  let currentLine = '';
  let currentLength = 0;
  let linesRemaining = targetLineCount;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const wordsRemaining = words.length - i;

    // Force a line break if we're approaching the average and have enough remaining
    const shouldBreak =
      currentLength > 0 &&
      linesRemaining > 1 &&
      (currentLength + word.length > avgCharsPerLine * 1.1 ||
        wordsRemaining <= linesRemaining);

    if (shouldBreak) {
      lines.push(currentLine);
      currentLine = word;
      currentLength = word.length;
      linesRemaining--;
    } else {
      currentLine = currentLine ? `${currentLine} ${word}` : word;
      currentLength += word.length + (currentLine.length > word.length ? 1 : 0);
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  // Verify all lines fit
  const allFit = lines.every((line) => estimateTextWidth(line, fontSize) <= maxWidth);
  if (!allFit) {
    // Fall back to simple wrapping
    return simpleWrap(words, maxWidth, fontSize);
  }

  return lines;
}

function simpleWrap(words: string[], maxWidth: number, fontSize: number): string[] {
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (estimateTextWidth(testLine, fontSize) <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines;
}

/**
 * Estimate the pixel width of Arabic text at a given font size.
 * Arabic characters are generally wider than Latin due to ligatures and cursive connections.
 */
function estimateTextWidth(text: string, fontSize: number): number {
  let totalWidth = 0;

  for (const char of text) {
    const code = char.codePointAt(0) || 0;

    if (char === ' ') {
      totalWidth += fontSize * 0.3; // Space
    } else if (code >= 0x0600 && code <= 0x06FF) {
      // Arabic characters
      totalWidth += fontSize * ARABIC_CHAR_WIDTH_RATIO;
    } else if (code >= 0x0750 && code <= 0x077F) {
      // Arabic Supplement
      totalWidth += fontSize * ARABIC_CHAR_WIDTH_RATIO;
    } else if (code >= 0xFB50 && code <= 0xFDFF) {
      // Arabic Presentation Forms A
      totalWidth += fontSize * 0.6;
    } else if (code >= 0xFE70 && code <= 0xFEFF) {
      // Arabic Presentation Forms B
      totalWidth += fontSize * 0.5;
    } else if (code >= 0x0021 && code <= 0x007E) {
      // Latin ASCII
      totalWidth += fontSize * 0.5;
    } else {
      // Other (CJK, emoji, etc.)
      totalWidth += fontSize * 0.6;
    }
  }

  return totalWidth;
}

/**
 * Compact layout for vertical text regions (originally vertical CJK).
 * Uses smaller font sizes and narrow layout.
 */
function computeCompactLayout(
  usable: UsableArea,
  text: string,
  bbox: BoundingBox
): LayoutResult {
  // For vertical text regions, cap font size more aggressively
  const maxFont = Math.min(MAX_FONT_SIZE_PX * 0.6, usable.height * 0.15, usable.width * 0.4);
  let fontSize = Math.max(MIN_FONT_SIZE_PX, Math.floor(maxFont));

  // Try to fit
  while (fontSize >= MIN_FONT_SIZE_PX) {
    const lines = simpleWrap(text.split(/\s+/), usable.width, fontSize);
    const lineHeight = fontSize * ARABIC_LINE_HEIGHT_RATIO;
    const totalHeight = lines.length * lineHeight;

    if (totalHeight <= usable.height) {
      const offsetY = (bbox.height - totalHeight) / 2;
      return {
        fontSize,
        lines,
        totalHeight,
        offsetX: bbox.width / 2,
        offsetY: Math.max(0, offsetY),
        usableWidth: usable.width,
        fontWeight: DEFAULT_FONT_WEIGHT,
      };
    }

    fontSize--;
  }

  // Absolute fallback
  return createFallbackLayout(usable, text, bbox);
}

function createFallbackLayout(
  usable: UsableArea,
  text: string,
  bbox: BoundingBox
): LayoutResult {
  const fontSize = MIN_FONT_SIZE_PX;
  const lines = simpleWrap(text.split(/\s+/), usable.width, fontSize);
  const lineHeight = fontSize * ARABIC_LINE_HEIGHT_RATIO;
  const totalHeight = lines.length * lineHeight;

  return {
    fontSize,
    lines,
    totalHeight,
    offsetX: bbox.width / 2,
    offsetY: Math.max(0, (bbox.height - totalHeight) / 2),
    usableWidth: usable.width,
    fontWeight: DEFAULT_FONT_WEIGHT,
  };
}

/**
 * Compute layouts for all overlays in a page.
 */
export function computePageLayouts(overlays: TextOverlay[]): TextOverlay[] {
  return overlays.map((overlay) => {
    if (!overlay.translatedText || overlay.translatedText.length === 0) {
      return overlay;
    }

    const shape = overlay.bubblePolygon?.shape || 'rectangle';
    const layoutResult = computeLayout(
      overlay.bbox,
      overlay.translatedText,
      shape,
      overlay.isVertical
    );

    return {
      ...overlay,
      layoutResult,
    };
  });
}
