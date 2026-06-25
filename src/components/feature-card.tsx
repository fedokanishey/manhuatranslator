import { Card, CardContent } from '@/components/ui/card';

interface FeatureCardProps {
  title: string;
  description: string;
  icon: string;
  index: number;
}

const iconMap: Record<string, React.ReactNode> = {
  scan: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M7 12h10" />
      <path d="M7 8h6" />
      <path d="M7 16h8" />
    </svg>
  ),
  languages: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 8 6 6" />
      <path d="m4 14 6-6 2-3" />
      <path d="M2 5h12" />
      <path d="M7 2h1" />
      <path d="m22 22-5-10-5 10" />
      <path d="M14 18h6" />
    </svg>
  ),
  layers: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
      <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
    </svg>
  ),
  zap: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
    </svg>
  ),
};

const glowColors = [
  'from-purple-500/20 to-violet-500/5',
  'from-pink-500/20 to-rose-500/5',
  'from-cyan-500/20 to-blue-500/5',
  'from-amber-500/20 to-yellow-500/5',
];

const iconBgColors = [
  'bg-purple-500/15 text-purple-400',
  'bg-pink-500/15 text-pink-400',
  'bg-cyan-500/15 text-cyan-400',
  'bg-amber-500/15 text-amber-400',
];

export function FeatureCard({ title, description, icon, index }: FeatureCardProps) {
  return (
    <Card
      className="group relative overflow-hidden border-border/30 bg-card/50 hover:bg-card/80 
                 transition-all duration-500 hover:border-border/60 hover:-translate-y-1"
      id={`feature-card-${index}`}
    >
      <div
        className={`absolute inset-0 bg-gradient-to-br ${glowColors[index % glowColors.length]} 
                    opacity-0 group-hover:opacity-100 transition-opacity duration-500`}
      />
      <CardContent className="relative p-6">
        <div
          className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl ${
            iconBgColors[index % iconBgColors.length]
          } transition-transform duration-300 group-hover:scale-110`}
        >
          {iconMap[icon] || iconMap.zap}
        </div>
        <h3 className="mb-2 text-lg font-semibold text-foreground">{title}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
