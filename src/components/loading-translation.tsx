'use client';

interface LoadingTranslationProps {
  progress: number;
  statusMessage: string;
}

const stages = [
  { label: 'Fetching Page', icon: '🌐', threshold: 15 },
  { label: 'Parsing HTML', icon: '📄', threshold: 25 },
  { label: 'Downloading Images', icon: '🖼️', threshold: 40 },
  { label: 'Running OCR', icon: '🔍', threshold: 60 },
  { label: 'Translating', icon: '🌍', threshold: 80 },
  { label: 'Building Result', icon: '✨', threshold: 95 },
];

export function LoadingTranslation({ progress, statusMessage }: LoadingTranslationProps) {
  return (
    <div className="w-full max-w-lg mx-auto py-16 px-4">
      {/* Main spinner */}
      <div className="flex justify-center mb-8">
        <div className="relative">
          <div className="h-20 w-20 rounded-full border-4 border-secondary animate-spin border-t-primary" />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm font-bold text-primary">{Math.round(progress)}%</span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="progress-bar mb-6">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>

      {/* Status message */}
      <p className="text-center text-base font-medium text-foreground mb-8">
        {statusMessage || 'Initializing...'}
      </p>

      {/* Stage indicators */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {stages.map((stage) => {
          const isActive = progress >= stage.threshold - 10 && progress < stage.threshold + 10;
          const isComplete = progress >= stage.threshold;

          return (
            <div
              key={stage.label}
              className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-all duration-300 ${
                isActive
                  ? 'bg-primary/15 text-primary border border-primary/30'
                  : isComplete
                    ? 'bg-secondary/50 text-foreground/80'
                    : 'bg-secondary/20 text-muted-foreground/50'
              }`}
            >
              <span className="text-base">{isComplete ? '✅' : stage.icon}</span>
              <span className="font-medium truncate">{stage.label}</span>
            </div>
          );
        })}
      </div>

      {/* Hint */}
      <p className="text-center text-xs text-muted-foreground/50 mt-8">
        This may take a minute for chapters with many images...
      </p>
    </div>
  );
}
