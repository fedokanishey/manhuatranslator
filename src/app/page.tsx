'use client';

import { UrlInput } from '@/components/url-input';
import { FeatureCard } from '@/components/feature-card';
import { LoadingTranslation } from '@/components/loading-translation';
import { TranslationViewer } from '@/components/translation-viewer';
import { useTranslation } from '@/hooks/use-translation';
import { FEATURES, APP_NAME } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';

export default function HomePage() {
  const { result, isLoading, error, progress, statusMessage, translate, reset } = useTranslation();

  // Show translation result
  if (result) {
    return (
      <div className="py-8 px-4">
        <TranslationViewer result={result} onReset={reset} />
      </div>
    );
  }

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[70vh]">
        <LoadingTranslation progress={progress} statusMessage={statusMessage} />
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-hero" id="hero">
        {/* Decorative elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-primary/5 blur-3xl animate-float" />
          <div className="absolute top-20 -left-20 h-60 w-60 rounded-full bg-accent/5 blur-3xl animate-float" style={{ animationDelay: '2s' }} />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 h-40 w-[600px] rounded-full bg-primary/3 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-28 lg:py-36">
          <div className="text-center max-w-3xl mx-auto">
            {/* Badge */}
            <Badge
              variant="outline"
              className="mb-6 border-primary/30 bg-primary/10 text-primary px-4 py-1.5 text-sm font-medium animate-float"
            >
              ✨ AI-Powered Translation Engine
            </Badge>

            {/* Title */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-6">
              Translate Manga{' '}
              <span className="text-gradient">Instantly</span>{' '}
              <br className="hidden sm:block" />
              to Arabic
            </h1>

            {/* Subtitle */}
            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
              Paste any manga, manhwa, or webtoon chapter URL and get an instant Arabic translation.
              {APP_NAME} uses OCR and AI to detect text in images and translate it automatically.
            </p>

            {/* URL Input */}
            <UrlInput onSubmit={translate} isLoading={isLoading} />

            {/* Error display */}
            {error && (
              <div className="mt-4 mx-auto max-w-2xl rounded-xl border border-destructive/30 bg-destructive/10 p-4" id="translation-error">
                <p className="text-sm text-destructive flex items-center gap-2 justify-center">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  {error}
                </p>
              </div>
            )}

            {/* Supported formats hint */}
            <div className="mt-6 flex items-center justify-center gap-3 flex-wrap">
              <span className="text-xs text-muted-foreground/50">Supports:</span>
              {['Manga', 'Manhwa', 'Webtoon', 'Light Novels'].map((type) => (
                <span
                  key={type}
                  className="text-xs text-muted-foreground/40 bg-secondary/30 rounded-full px-3 py-1"
                >
                  {type}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 sm:py-20 px-4 sm:px-6" id="how-it-works">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">
              How It Works
            </h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              Three simple steps to read manga in Arabic
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto mb-16">
            {[
              {
                step: '01',
                title: 'Paste URL',
                desc: 'Copy the chapter URL from your favorite manga site',
              },
              {
                step: '02',
                title: 'AI Processing',
                desc: 'OCR detects text in images, then AI translates it to Arabic',
              },
              {
                step: '03',
                title: 'Read & Enjoy',
                desc: 'View the translated chapter with Arabic text overlays',
              },
            ].map((item, idx) => (
              <div key={idx} className="text-center group">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary text-lg font-bold mb-4 group-hover:bg-primary/20 group-hover:scale-110 transition-all duration-300">
                  {item.step}
                </div>
                <h3 className="text-base font-semibold text-foreground mb-1.5">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 border-t border-border/20" id="features">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">
              Powerful Features
            </h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              Everything you need for seamless manga translation
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURES.map((feature, index) => (
              <FeatureCard
                key={feature.title}
                title={feature.title}
                description={feature.description}
                icon={feature.icon}
                index={index}
              />
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 sm:py-20 px-4 sm:px-6" id="cta">
        <div className="mx-auto max-w-2xl text-center">
          <div className="glass-card rounded-2xl p-8 sm:p-12 glow-purple">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-4">
              Ready to Start Reading?
            </h2>
            <p className="text-muted-foreground mb-8">
              Paste a chapter URL above and get your first translation in seconds. No sign-up required.
            </p>
            <button
              onClick={() => {
                const input = document.getElementById('url-input');
                if (input) {
                  input.scrollIntoView({ behavior: 'smooth' });
                  input.focus();
                }
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-8 py-3.5 text-base font-semibold text-primary-foreground hover:bg-primary/90 transition-all glow-purple hover:glow-pink"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 8 6 6" />
                <path d="m4 14 6-6 2-3" />
                <path d="M2 5h12" />
                <path d="M7 2h1" />
                <path d="m22 22-5-10-5 10" />
                <path d="M14 18h6" />
              </svg>
              Translate Now
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
