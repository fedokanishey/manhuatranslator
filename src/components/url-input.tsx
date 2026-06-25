'use client';

import { useState, type FormEvent, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface UrlInputProps {
  onSubmit: (url: string) => void;
  isLoading: boolean;
}

export function UrlInput({ onSubmit, isLoading }: UrlInputProps) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  const validate = useCallback((value: string): boolean => {
    if (!value.trim()) {
      setError('Please enter a chapter URL');
      return false;
    }
    try {
      const parsed = new URL(value.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setError('Only HTTP and HTTPS URLs are supported');
        return false;
      }
      setError('');
      return true;
    } catch {
      setError('Please enter a valid URL');
      return false;
    }
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (validate(url)) {
      onSubmit(url.trim());
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text');
    if (pasted) {
      setTimeout(() => {
        setUrl(pasted);
        setError('');
      }, 0);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto">
      <div className="relative flex flex-col gap-3 sm:flex-row sm:gap-0">
        <div className="relative flex-1">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/60">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </div>
          <Input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError('');
            }}
            onPaste={handlePaste}
            placeholder="https://example.com/manga/chapter-12"
            disabled={isLoading}
            className="h-14 pl-12 pr-4 text-base rounded-xl sm:rounded-r-none border-border/60 bg-secondary/30 
                       placeholder:text-muted-foreground/40 focus:bg-secondary/50 focus:border-primary/50 
                       transition-all duration-300"
            id="url-input"
          />
        </div>
        <Button
          type="submit"
          disabled={isLoading || !url.trim()}
          className="h-14 px-8 rounded-xl sm:rounded-l-none text-base font-semibold
                     bg-primary hover:bg-primary/90 text-primary-foreground
                     disabled:opacity-40 transition-all duration-300
                     glow-purple hover:glow-pink"
          id="translate-button"
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Translating...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m5 8 6 6" />
                <path d="m4 14 6-6 2-3" />
                <path d="M2 5h12" />
                <path d="M7 2h1" />
                <path d="m22 22-5-10-5 10" />
                <path d="M14 18h6" />
              </svg>
              Translate Chapter
            </span>
          )}
        </Button>
      </div>
      {error && (
        <p className="mt-2 text-sm text-destructive flex items-center gap-1.5 pl-1" id="url-error">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </p>
      )}
    </form>
  );
}
