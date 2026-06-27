'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ImageOverlay } from '@/components/image-overlay';
import type { TranslationResult, TranslatedPage } from '@/types/translation';

interface TranslationViewerProps {
  result: TranslationResult;
  onReset: () => void;
}

export function TranslationViewer({ result, onReset }: TranslationViewerProps) {
  const [showOriginal, setShowOriginal] = useState(false);

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-foreground">
            {result.title || 'Translated Chapter'}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {result.sourceUrl && !result.sourceUrl.startsWith('upload://') && (
              <a href={result.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
                Source ↗
              </a>
            )}
            {result.pages && (
              <span className="ml-2">• {result.pages.length} pages</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Toggle: Show Original vs Translation */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowOriginal(!showOriginal)}
            className="rounded-lg text-xs"
          >
            {showOriginal ? (
              <span className="flex items-center gap-1.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                Show Translation
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
                Show Original
              </span>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            className="rounded-lg text-xs"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            New Translation
          </Button>
        </div>
      </div>

      {/* Image Pages */}
      {result.pages && result.pages.length > 0 && (
        <div className="manga-reader">
          {result.pages.map((page, idx) => (
            <PageRenderer
              key={page.pageIndex ?? idx}
              page={page}
              showOriginal={showOriginal}
            />
          ))}
        </div>
      )}

      {/* Text Content */}
      {result.textBlocks && result.textBlocks.length > 0 && (
        <div className="glass-card rounded-xl p-6 space-y-4 mt-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Translated Text</h3>
          {result.textBlocks.map((block, idx) => (
            <div key={idx} className="border-b border-border/20 pb-3 last:border-0">
              <p className="text-sm text-muted-foreground mb-1">{block.original}</p>
              <p className="text-base text-foreground" dir="rtl">{block.translated}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page Renderer ────────────────────────────────────────────────────

function PageRenderer({ page, showOriginal }: { page: TranslatedPage; showOriginal: boolean }) {
  if (page.loading) {
    return (
      <div className="manga-page bg-muted/30 rounded-lg flex items-center justify-center" style={{ minHeight: 200 }}>
        <div className="flex flex-col items-center gap-3 p-8">
          <svg className="animate-spin h-6 w-6 text-primary" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm text-muted-foreground">Translating page {page.pageIndex + 1}...</p>
        </div>
      </div>
    );
  }

  // Use inpainted image for translation view, original for "Show Original"
  const isUpload = page.imageUrl?.startsWith('upload://');
  // If the page has an error, show the original image instead of the inpainted one
  const imageSrc = (showOriginal || page.error)
    ? (isUpload ? (page.originalBase64 || page.imageBase64) : (page.imageUrl || page.imageBase64))
    : (page.imageBase64 || page.imageUrl);

  return (
    <div className="manga-page" id={`page-${page.pageIndex}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageSrc}
        alt={`Page ${page.pageIndex + 1}`}
        width={page.width}
        height={page.height}
        loading="lazy"
      />

      {page.error && (
        <div className="absolute top-4 left-4 z-20 bg-amber-500/90 text-black px-3 py-1.5 rounded-lg text-xs font-semibold shadow-lg flex items-center gap-1.5 pointer-events-auto select-none">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          عذرًا، تعذر ترجمة هذه الصفحة. تم عرض الأصلية.
        </div>
      )}

      {/* Overlays only shown in translation mode and when there is no error */}
      {!showOriginal && !page.error && page.overlays && page.overlays.length > 0 && (
        <ImageOverlay
          overlays={page.overlays}
          imageWidth={page.width}
          imageHeight={page.height}
        />
      )}
    </div>
  );
}

