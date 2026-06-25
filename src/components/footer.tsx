import { APP_NAME } from '@/lib/constants';

export function Footer() {
  return (
    <footer className="border-t border-border/40 py-8 mt-auto">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-primary"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="m15 9-6 6" />
                <path d="m9 9 6 6" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-muted-foreground">{APP_NAME}</span>
          </div>
          <p className="text-xs text-muted-foreground/60">
            AI-Powered Manga & Manhwa Translation — Built with Next.js, Tesseract.js & OCR
          </p>
        </div>
      </div>
    </footer>
  );
}
