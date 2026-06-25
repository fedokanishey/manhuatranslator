import type { OCRResult, OCRWord, BoundingBox } from '@/types/translation';
import { MIN_OCR_CONFIDENCE } from '../constants';

export async function runOCR(imageBuffer: Buffer, langs: string[] = ['eng', 'jpn', 'kor', 'chi_sim']): Promise<OCRResult> {
  const { createWorker, OEM, PSM } = await import('tesseract.js');
  const worker = await createWorker(langs, OEM.DEFAULT, {
    logger: () => {},
  });

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
    });

    const { data } = await worker.recognize(imageBuffer, {}, { blocks: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dataAny = data as any;
    
    // Debug logging
    console.log('[OCR] Full text:', JSON.stringify(data.text?.slice(0, 200)));
    console.log('[OCR] Blocks count:', data.blocks?.length || 0);
    console.log('[OCR] Confidence:', data.confidence);
    
    const blockParagraphs: OCRWord[] = [];
    
    if (data.blocks && data.blocks.length > 0) {
      console.log('[OCR] Extracting paragraphs from blocks');
      for (const block of data.blocks) {
        if (block.paragraphs) {
          for (const para of block.paragraphs) {
            const cleanedText = cleanOCRText(para.text);
            if (cleanedText.length > 0 && para.confidence >= MIN_OCR_CONFIDENCE) {
              blockParagraphs.push({
                text: cleanedText,
                confidence: para.confidence,
                bbox: {
                  x: para.bbox.x0,
                  y: para.bbox.y0,
                  width: para.bbox.x1 - para.bbox.x0,
                  height: para.bbox.y1 - para.bbox.y0,
                } as BoundingBox,
              });
            }
          }
        }
      }
    }

    // Recover any missed text bubbles using lines/words grouping fallback
    let rawLines: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }> = [];
    if (dataAny.lines && dataAny.lines.length > 0) {
      rawLines = dataAny.lines;
    } else if (dataAny.words && dataAny.words.length > 0) {
      // Rebuild lines from words using proximity grouping if lines is empty
      const filteredWords: OCRWord[] = dataAny.words
        .map((w: any) => ({
          text: cleanOCRText(w.text),
          confidence: w.confidence,
          bbox: {
            x: w.bbox.x0,
            y: w.bbox.y0,
            width: w.bbox.x1 - w.bbox.x0,
            height: w.bbox.y1 - w.bbox.y0,
          } as BoundingBox,
        }))
        .filter((w: any) => w.text.length > 0 && w.confidence >= MIN_OCR_CONFIDENCE);
      rawLines = groupWordsByProximity(filteredWords).map(l => ({
        text: l.text,
        confidence: l.confidence,
        bbox: {
          x0: l.bbox.x,
          y0: l.bbox.y,
          x1: l.bbox.x + l.bbox.width,
          y1: l.bbox.y + l.bbox.height,
        }
      }));
    }

    const filteredLines: OCRWord[] = rawLines
      .map((l) => ({
        text: cleanOCRText(l.text),
        confidence: l.confidence,
        bbox: {
          x: l.bbox.x0,
          y: l.bbox.y0,
          width: l.bbox.x1 - l.bbox.x0,
          height: l.bbox.y1 - l.bbox.y0,
        } as BoundingBox,
      }))
      .filter((l) => l.text.length > 0 && l.confidence >= MIN_OCR_CONFIDENCE);

    const customParagraphs = groupLinesIntoParagraphs(filteredLines);

    // Merge custom paragraphs that don't significantly overlap with any blockParagraphs
    const words: OCRWord[] = [...blockParagraphs];
    for (const customPara of customParagraphs) {
      const isMissed = !blockParagraphs.some((blockPara) => 
        boxesOverlap(customPara.bbox, blockPara.bbox)
      );
      if (isMissed) {
        console.log('[OCR] Recovered missed text bubble:', customPara.text);
        words.push(customPara);
      }
    }

    const fullText = words.map((w) => w.text).join(' ');
    const totalConfidence = words.reduce((sum, w) => sum + w.confidence, 0);
    const averageConfidence = words.length > 0 ? totalConfidence / words.length : 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const detectedScript = (data as any).script || 'unknown';

    return {
      words,
      fullText,
      averageConfidence,
      language: detectedScript,
    };
  } finally {
    await worker.terminate();
  }
}

export function cleanOCRText(text: string): string {
  if (!text) return '';

  // Remove lines/patterns representing scanlation credits/watermarks
  const watermarkPatterns = [
    /read\s*first\s*at/gi,
    /read\s*first\s*on/gi,
    /mangacultivator/gi,
    /anshscans/gi,
    /dsc\.gg/gi,
    /patreon\.com/gi,
    /discord/gi,
    /scans/gi,
    /webtoon/gi
  ];

  let cleaned = text;
  for (const pattern of watermarkPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Remove specific speed lines or visual noise characters
  const words = cleaned.split(/\s+/);
  const cleanedWords = words.map(word => {
    // If a word is just symbols or single letters combined with symbols (like "—=" or "y=" or "I=")
    // Strip purely non-alphanumeric words unless they are valid punctuation
    if (/^[~\-=_|\\\/+*#^&<>§]+$/.test(word)) {
      return '';
    }
    // Strip trailing/leading symbols from words (e.g. "=WHAT" -> "WHAT")
    let w = word.replace(/^[~\-=_|\\\/+*#^&<>]+/g, '');
    w = w.replace(/[~\-=_|\\\/+*#^&<>]+$/g, '');
    return w;
  }).filter(Boolean);

  cleaned = cleanedWords.join(' ');

  // Clean repeated punctuation
  cleaned = cleaned.replace(/[\-=_|\\\/+*#^&<>]+/g, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // If the cleaned text has very few letters relative to its length (mostly garbage symbols), discard
  const letterCount = (cleaned.match(/[a-zA-Z]/g) || []).length;
  if (cleaned.length > 0 && letterCount / cleaned.length < 0.3) {
    return '';
  }

  return cleaned;
}

function boxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const overlapArea = xOverlap * yOverlap;
  
  if (overlapArea <= 0) return false;
  
  const aArea = a.width * a.height;
  const bArea = b.width * b.height;
  const minArea = Math.min(aArea, bArea);
  
  // If overlap area is more than 30% of the smaller box, they overlap significantly
  return (overlapArea / minArea) > 0.3;
}

function groupLinesIntoParagraphs(lines: OCRWord[]): OCRWord[] {
  if (lines.length === 0) return [];

  // Sort lines vertically by top coordinate
  const sorted = [...lines].sort((a, b) => a.bbox.y - b.bbox.y);
  
  const paragraphs: OCRWord[][] = [];
  const visited = new Set<number>();

  for (let i = 0; i < sorted.length; i++) {
    if (visited.has(i)) continue;

    const currentParagraph: OCRWord[] = [sorted[i]];
    visited.add(i);

    let added = true;
    while (added) {
      added = false;
      
      const minX = Math.min(...currentParagraph.map(l => l.bbox.x));
      const maxX = Math.max(...currentParagraph.map(l => l.bbox.x + l.bbox.width));
      const minY = Math.min(...currentParagraph.map(l => l.bbox.y));
      const maxY = Math.max(...currentParagraph.map(l => l.bbox.y + l.bbox.height));
      const pBbox = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

      for (let j = 0; j < sorted.length; j++) {
        if (visited.has(j)) continue;

        const candidate = sorted[j];
        const avgLineHeight = Math.max(
          ...currentParagraph.map(l => l.bbox.height),
          candidate.bbox.height
        );

        // Candidate top should be close to paragraph bottom
        const verticalDistance = candidate.bbox.y - (pBbox.y + pBbox.height);
        
        // Candidate should align horizontally with paragraph center
        const pCenterX = pBbox.x + pBbox.width / 2;
        const candidateCenterX = candidate.bbox.x + candidate.bbox.width / 2;
        const horizontalDistance = Math.abs(candidateCenterX - pCenterX);

        const maxHorizontalOffset = Math.max(pBbox.width, candidate.bbox.width) * 0.8;

        if (verticalDistance >= -5 && verticalDistance < avgLineHeight * 2.2 && horizontalDistance < maxHorizontalOffset) {
          currentParagraph.push(candidate);
          visited.add(j);
          added = true;
        }
      }
    }
    paragraphs.push(currentParagraph);
  }

  return paragraphs.map((group) => {
    const text = group.map((w) => w.text).join(' ');
    const avgConfidence = group.reduce((s, w) => s + w.confidence, 0) / group.length;
    const minX = Math.min(...group.map((w) => w.bbox.x));
    const minY = Math.min(...group.map((w) => w.bbox.y));
    const maxX = Math.max(...group.map((w) => w.bbox.x + w.bbox.width));
    const maxY = Math.max(...group.map((w) => w.bbox.y + w.bbox.height));

    return {
      text,
      confidence: avgConfidence,
      bbox: {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      },
    };
  });
}

function groupWordsByProximity(words: OCRWord[]): OCRWord[] {
  if (words.length === 0) return [];

  const sorted = [...words].sort((a, b) => {
    const yDiff = a.bbox.y - b.bbox.y;
    if (Math.abs(yDiff) < 8) {
      return a.bbox.x - b.bbox.x;
    }
    return yDiff;
  });

  const groups: OCRWord[][] = [];
  let currentGroup: OCRWord[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const verticalGap = Math.abs(curr.bbox.y - prev.bbox.y);
    const lineHeight = Math.max(prev.bbox.height, curr.bbox.height);

    if (verticalGap < lineHeight * 0.8) {
      currentGroup.push(curr);
    } else {
      groups.push(currentGroup);
      currentGroup = [curr];
    }
  }
  groups.push(currentGroup);

  return groups.map((group) => {
    const text = group.map((w) => w.text).join(' ');
    const avgConfidence = group.reduce((s, w) => s + w.confidence, 0) / group.length;
    const minX = Math.min(...group.map((w) => w.bbox.x));
    const minY = Math.min(...group.map((w) => w.bbox.y));
    const maxX = Math.max(...group.map((w) => w.bbox.x + w.bbox.width));
    const maxY = Math.max(...group.map((w) => w.bbox.y + w.bbox.height));

    return {
      text,
      confidence: avgConfidence,
      bbox: {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      },
    };
  });
}

export async function runOCRBatch(imageBuffers: Buffer[], langs: string[] = ['eng', 'jpn', 'kor', 'chi_sim']): Promise<OCRResult[]> {
  const results: OCRResult[] = [];
  
  // Process sequentially to avoid memory issues
  for (const buffer of imageBuffers) {
    try {
      const result = await runOCR(buffer, langs);
      results.push(result);
    } catch (error) {
      console.error('[OCR] Failed for image:', error);
      results.push({
        words: [],
        fullText: '',
        averageConfidence: 0,
        language: 'unknown',
      });
    }
  }

  return results;
}
