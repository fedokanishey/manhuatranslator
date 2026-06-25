'use client';

import { useState, useCallback } from 'react';
import type { TranslationResult } from '@/types/translation';

interface UseTranslationReturn {
  result: TranslationResult | null;
  isLoading: boolean;
  error: string | null;
  progress: number;
  statusMessage: string;
  translate: (url: string, targetLang?: string) => Promise<void>;
  reset: () => void;
}

export function useTranslation(): UseTranslationReturn {
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');

  const translate = useCallback(async (url: string, targetLang: string = 'ar') => {
    setIsLoading(true);
    setError(null);
    setResult(null);
    setProgress(10);
    setStatusMessage('Starting translation...');

    try {
      // Simulate progress stages since we're using a simple POST
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
        const imagesList = data.images;
        // Multi-step incremental page loading
        const initialPages = imagesList.map((img: any) => ({
          pageIndex: img.index,
          imageUrl: img.src,
          imageBase64: '', // Empty initially
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

        const CONCURRENCY = 1;
        const imagesToTranslate = [...imagesList];
        let completedCount = 0;

        const translatePageWorker = async (img: any) => {
          try {
            const pageRes = await fetch('/api/translate/page', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                imageUrl: img.src,
                index: img.index,
                targetLang,
                langs: data.langs,
              }),
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
              updatedPages[img.index] = {
                ...translatedPage,
                loading: false,
              };
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
              updatedPages[img.index] = {
                ...updatedPages[img.index],
                loading: false,
                error: pageErr instanceof Error ? pageErr.message : 'Translation failed',
              } as any;
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
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setIsLoading(false);
    setError(null);
    setProgress(0);
    setStatusMessage('');
  }, []);

  return {
    result,
    isLoading,
    error,
    progress,
    statusMessage,
    translate,
    reset,
  };
}
