'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ImageOverlay } from '@/components/image-overlay';
import type { TranslationResult } from '@/types/translation';

interface TranslationViewerProps {
  result: TranslationResult;
  onReset: () => void;
}

export function TranslationViewer({ result, onReset }: TranslationViewerProps) {
  const [showOverlays, setShowOverlays] = useState(true);

  return (
    <div className="w-full max-w-4xl mx-auto" id="translation-viewer">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground mb-1">{result.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {result.contentType === 'image' ? '🖼️ Image' : result.contentType === 'mixed' ? '📄 Mixed' : '📝 Text'}
            </Badge>
            {result.cached && (
              <Badge variant="outline" className="text-xs text-amber-400 border-amber-400/30">
                ⚡ Cached
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {(result.processingTimeMs / 1000).toFixed(1)}s
            </span>
            {result.pages && (
              <span className="text-xs text-muted-foreground">
                • {result.pages.length} pages
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {result.pages && result.pages.some((p) => p.overlays.length > 0) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowOverlays(!showOverlays)}
              className="text-xs"
              id="toggle-overlays"
            >
              {showOverlays ? 'Hide' : 'Show'} Translation
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            className="text-xs"
            id="translate-new"
          >
            ← Translate New
          </Button>
        </div>
      </div>

      <Separator className="mb-6 bg-border/30" />

      {/* Image Content */}
      {result.pages && result.pages.length > 0 && (
        <div className="manga-reader">
          {result.pages.map((page, idx) => (
            <div 
              key={`page-${idx}-${page.pageIndex}`} 
              className={`manga-page relative bg-secondary/10 rounded-xl my-6 border border-border/10 overflow-hidden ${
                page.loading || page.error ? 'min-h-[300px] flex flex-col items-center justify-center' : ''
              }`}
            >
              {page.loading ? (
                <div className="flex flex-col items-center justify-center p-8 text-center space-y-4">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">Translating Page {page.pageIndex + 1}</p>
                    <p className="text-xs text-muted-foreground/60">Running OCR & translating text bubbles...</p>
                  </div>
                </div>
              ) : page.error ? (
                <div className="flex flex-col items-center justify-center p-8 text-center space-y-3">
                  <div className="rounded-full bg-destructive/10 p-3 text-destructive">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-destructive">Failed to translate Page {page.pageIndex + 1}</p>
                    <p className="text-xs text-muted-foreground/60">{page.error}</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="relative w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={page.imageBase64}
                      alt={`Page ${page.pageIndex + 1}`}
                      width={page.width}
                      height={page.height}
                      loading="lazy"
                    />
                    {showOverlays && page.overlays.length > 0 && (
                      <ImageOverlay
                        overlays={page.overlays}
                        imageWidth={page.width}
                        imageHeight={page.height}
                        imageBase64={page.imageBase64}
                      />
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Text Content */}
      {result.textBlocks && result.textBlocks.length > 0 && (
        <div className="space-y-4 mt-6" dir="rtl">
          <h2 className="text-lg font-semibold text-foreground mb-4 text-right">
            المحتوى المترجم
          </h2>
          {result.textBlocks.map((block, idx) => (
            <div
              key={idx}
              className="rounded-xl border border-border/30 bg-card/50 p-4 transition-colors hover:bg-card/70"
            >
              <p className="text-base leading-relaxed text-foreground font-medium text-right">
                {block.translated}
              </p>
              <p className="mt-2 text-xs text-muted-foreground/50 text-left" dir="ltr">
                {block.original}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Source attribution */}
      <div className="mt-8 py-4 text-center">
        <p className="text-xs text-muted-foreground/40">
          Source:{' '}
          <a
            href={result.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-muted-foreground/60 transition-colors"
          >
            {result.sourceUrl}
          </a>
        </p>
      </div>
    </div>
  );
}
