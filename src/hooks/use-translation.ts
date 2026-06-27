'use client';
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

import { useState, useCallback } from 'react';

import type { TranslationResult, FetchError } from '@/types/translation';

interface UseTranslationReturn {
  result: TranslationResult | null;
  isLoading: boolean;
  error: string | null;
  fetchError: FetchError | null;
  progress: number;
  statusMessage: string;
  translate: (url: string, targetLang?: string) => Promise<void>;
  translateFromUpload: (files: File[], targetLang?: string) => Promise<void>;
  reset: () => void;
}

export function useTranslation(): UseTranslationReturn {
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<FetchError | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');

  // ── Page-by-page translation worker ────────────────────────────────

  const translatePages = useCallback(async (
    imagesList: any[],
    data: any,
    targetLang: string
  ) => {
    const initialPages = imagesList.map((img: any) => ({
      pageIndex: img.index,
      imageUrl: img.src || `upload://${img.index}`,
      imageBase64: '',
      originalBase64: img.base64 || '',
      width: img.width || 800,
      height: img.height || 1200,
      overlays: [],
      loading: true,
    }));


    setResult({
      ...data,
      pages: initialPages,
    });

    setProgress(15);
    setStatusMessage(`Starting page translation (0/${imagesList.length})...`);

    const CONCURRENCY = 3;
    const imagesToTranslate = [...imagesList];
    let completedCount = 0;


    const translatePageWorker = async (img: any) => {
      try {
        const body: any = {
          imageUrl: img.src || `upload://${img.index}`,
          index: img.index,
          targetLang,
          langs: data.langs,
        };

        // If this is an uploaded image with base64 data, include it
        if (img.base64) {
          body.imageBase64 = img.base64;
        }

        const pageRes = await fetch('/api/translate/page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!pageRes.ok) {
          let errorMsg = `HTTP ${pageRes.status}`;
          try {
            const errData = await pageRes.json();
            if (errData && errData.error) {
              errorMsg = errData.error;
            }
          } catch (e) {
            // Ignore
          }
          throw new Error(errorMsg);
        }

        const pageData = await pageRes.json();
        if (!pageData.success || !pageData.page) {
          throw new Error(pageData.error || 'Failed to translate page');
        }

        const translatedPage = pageData.page;

        setResult((prevResult) => {
          if (!prevResult || !prevResult.pages) return prevResult;
          const updatedPages = [...prevResult.pages];
          const pageIdx = updatedPages.findIndex((p) => p && p.pageIndex === img.index);
          if (pageIdx !== -1) {
            updatedPages[pageIdx] = {
              ...translatedPage,
              loading: false,
            };
          }
          return {
            ...prevResult,
            pages: updatedPages,
          };
        });
      } catch (pageErr) {
        console.error(`Failed to translate page ${img.index}:`, pageErr);
        setResult((prevResult) => {
          if (!prevResult || !prevResult.pages) return prevResult;
          const updatedPages = [...prevResult.pages];
          const pageIdx = updatedPages.findIndex((p) => p && p.pageIndex === img.index);
          if (pageIdx !== -1) {
            updatedPages[pageIdx] = {
              ...updatedPages[pageIdx],
              loading: false,
              error: pageErr instanceof Error ? pageErr.message : 'Translation failed',
            } as any;
          }
          return {
            ...prevResult,
            pages: updatedPages,
          };
        });
      } finally {
        completedCount++;
        const currentProgress = 15 + Math.round((completedCount / imagesList.length) * 80);
        setProgress(Math.min(currentProgress, 95));
        setStatusMessage(`Translated ${completedCount}/${imagesList.length} pages...`);
      }
    };

    const workers = Array.from({ length: Math.min(CONCURRENCY, imagesToTranslate.length) }).map(async () => {
      while (imagesToTranslate.length > 0) {
        const nextImg = imagesToTranslate.shift();
        if (nextImg) {
          await translatePageWorker(nextImg);
        }
      }
    });

    await Promise.all(workers);
    setProgress(100);
    setStatusMessage('Translation complete!');
  }, []);

  // ── URL Translation ────────────────────────────────────────────────

  const translate = useCallback(async (url: string, targetLang: string = 'ar') => {
    setIsLoading(true);
    setError(null);
    setFetchError(null);
    setResult(null);
    setProgress(10);
    setStatusMessage('Starting translation...');

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) return prev;
          const increment = Math.random() * 8 + 2;
          return Math.min(prev + increment, 90);
        });
      }, 2000);

      const stages = [
        'Fetching chapter page...',
        'Analyzing page structure...',
        'Downloading images...',
        'Running text recognition...',
        'Translating content...',
        'Building results...',
      ];

      let stageIndex = 0;
      const stageInterval = setInterval(() => {
        if (stageIndex < stages.length) {
          setStatusMessage(stages[stageIndex]);
          stageIndex++;
        }
      }, 3000);

      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, targetLang }),
      });

      clearInterval(progressInterval);
      clearInterval(stageInterval);

      if (response.status === 429) {
        const data = await response.json();
        throw new Error(data.error || 'Rate limited. Please wait and try again.');
      }

      const data: TranslationResult = await response.json();

      // Check for fetch errors (anti-bot, Cloudflare, etc.)
      if (data.fetchError) {
        setFetchError(data.fetchError);
        setError(data.fetchError.message);
        setProgress(0);
        setStatusMessage('');
        return;
      }

      if (!data.success) {
        throw new Error(data.error || 'Translation failed');
      }

      if (data.pages && data.pages.length > 0) {
        // Already fully translated (e.g., from cache)
        setProgress(100);
        setStatusMessage('Translation complete! (Cached)');
        setResult(data);
        return;
      }

      if (data.images && data.images.length > 0) {
        await translatePages(data.images, data, targetLang);
      } else {
        // Text-only or fallback
        setProgress(100);
        setStatusMessage('Translation complete!');
        setResult(data);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
      setProgress(0);
      setStatusMessage('');
    } finally {
      setIsLoading(false);
    }
  }, [translatePages]);

  // ── Upload Translation ─────────────────────────────────────────────

  const translateFromUpload = useCallback(async (files: File[], targetLang: string = 'ar') => {
    setIsLoading(true);
    setError(null);
    setFetchError(null);
    setResult(null);
    setProgress(5);
    setStatusMessage('Uploading images...');

    try {
      // Upload files
      const formData = new FormData();
      for (const file of files) {
        formData.append('files', file);
      }

      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!uploadRes.ok) {
        const errData = await uploadRes.json().catch(() => ({}));
        throw new Error(errData.error || `Upload failed: HTTP ${uploadRes.status}`);
      }

      const data = await uploadRes.json();

      if (!data.success || !data.images || data.images.length === 0) {
        throw new Error(data.error || 'No images found in upload');
      }

      setProgress(10);
      setStatusMessage(`Uploaded ${data.images.length} images. Starting translation...`);

      // Translate pages
      await translatePages(data.images, { ...data, langs: ['eng'] }, targetLang);

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      setProgress(0);
      setStatusMessage('');
    } finally {
      setIsLoading(false);
    }
  }, [translatePages]);

  // ── Reset ──────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    setResult(null);
    setIsLoading(false);
    setError(null);
    setFetchError(null);
    setProgress(0);
    setStatusMessage('');
  }, []);

  return {
    result,
    isLoading,
    error,
    fetchError,
    progress,
    statusMessage,
    translate,
    translateFromUpload,
    reset,
  };
}
