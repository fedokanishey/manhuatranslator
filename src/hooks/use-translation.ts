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

      setProgress(100);
      setStatusMessage('Translation complete!');
      setResult(data);
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
