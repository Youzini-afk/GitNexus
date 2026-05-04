import { Sparkles, Github } from '@/lib/lucide-icons';
import { RepoAnalyzer } from './RepoAnalyzer';
import { useT } from '../i18n';

interface AnalyzeOnboardingProps {
  onComplete: (repoName: string) => void;
}

export const AnalyzeOnboarding = ({ onComplete }: AnalyzeOnboardingProps) => {
  const t = useT();
  return (
    <div className="relative animate-fade-in overflow-hidden rounded-3xl border border-border-default bg-surface p-7">
      <div className="pointer-events-none absolute -top-28 -right-28 h-72 w-72 rounded-full bg-accent/6 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 h-56 w-56 rounded-full bg-node-function/6 blur-3xl" />

      <div className="relative mb-6">
        <div className="text-center">
          <div className="mb-2 inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-accent/70" />
            <span className="text-[11px] font-medium tracking-widest text-accent/80 uppercase">
              {t('app.title')}
            </span>
          </div>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/20 to-accent-dim/10 shadow-glow-soft">
            <Github className="h-7 w-7 text-accent" />
          </div>
          <h2 className="text-lg leading-snug font-semibold text-text-primary">
            {t('analyzeOnboarding.analyzeFirst')}
          </h2>
          <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-text-secondary">
            {t('analyzeOnboarding.description')}
          </p>
        </div>
      </div>

      <div className="relative">
        <RepoAnalyzer variant="onboarding" onComplete={onComplete} />
      </div>

      <p className="mt-5 text-center text-[11px] leading-relaxed text-text-muted">
        {t('analyzeOnboarding.footer')}
      </p>
    </div>
  );
};
