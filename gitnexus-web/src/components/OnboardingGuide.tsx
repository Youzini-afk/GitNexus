import { useState, useRef, useEffect } from 'react';
import { Check, Copy, Terminal, Server, Zap, Sparkles } from '@/lib/lucide-icons';
import { REQUIRED_NODE_VERSION } from '../config/ui-constants';
import { useT } from '../i18n';

const isDev = import.meta.env.DEV;

function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('Failed to copy command:', err);
      }
    }
  };

  return (
    <button
      onClick={handleCopy}
      aria-label={copied ? t('onboarding.done') : t('onboarding.copyCommand')}
      className={`shrink-0 cursor-pointer rounded-md px-2 py-1 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none ${
        copied
          ? 'bg-emerald-400/10 text-emerald-400'
          : 'text-text-muted hover:bg-white/5 hover:text-text-primary'
      } `}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function TerminalWindow({
  command,
  label,
  isActive = false,
}: {
  command: string;
  label: string;
  isActive?: boolean;
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border transition-all duration-300 ${
        isActive
          ? 'border-accent/40 shadow-glow-soft'
          : 'border-border-default hover:border-accent/20 hover:shadow-glow-soft'
      } `}
    >
      <div className="flex items-center gap-2 border-b border-border-subtle bg-deep px-4 py-2.5">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/60" />
        </div>
        <span className="flex-1 text-center font-mono text-[11px] text-text-muted">{label}</span>
        <CopyButton text={command} />
      </div>
      <div className="flex items-center gap-3 bg-void px-4 py-3.5 font-mono text-sm">
        <span className="text-accent/60 select-none" aria-hidden="true">$</span>
        <code className="flex-1 overflow-x-auto tracking-wide whitespace-nowrap text-text-primary">
          {command}
        </code>
      </div>
    </div>
  );
}

type StepState = 'waiting' | 'active' | 'done';

function StepDot({ state, number }: { state: StepState; number: number }) {
  if (state === 'done') {
    return (
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-500/50 bg-emerald-500/20">
        <Check className="h-3 w-3 text-emerald-400" />
      </div>
    );
  }
  if (state === 'active') {
    return (
      <div className="relative flex h-6 w-6 shrink-0 items-center justify-center">
        <div className="absolute inset-0 animate-ping rounded-full border border-accent/30" />
        <div className="flex h-6 w-6 items-center justify-center rounded-full border border-accent/60 bg-accent/20">
          <span className="text-[10px] leading-none font-semibold text-accent">{number}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-elevated">
      <span className="text-[10px] leading-none font-semibold text-text-muted">{number}</span>
    </div>
  );
}

function StepRow({
  state,
  number,
  title,
  description,
  children,
}: {
  state: StepState;
  number: number;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  const t = useT();
  const isVisible = state !== 'waiting';

  return (
    <div
      className={`transition-all duration-300 ${state === 'waiting' ? 'opacity-40' : 'opacity-100'} `}
    >
      <div className="flex items-start gap-3">
        <StepDot state={state} number={number} />
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-center gap-2">
            <span
              className={`text-sm font-medium transition-colors duration-200 ${
                state === 'done'
                  ? 'text-emerald-400'
                  : state === 'active'
                    ? 'text-text-primary'
                    : 'text-text-muted'
              }`}
            >
              {title}
            </span>
            {state === 'done' && (
              <span className="animate-fade-in font-mono text-[10px] tracking-wider text-emerald-400/60 uppercase">
                {t('onboarding.done')}
              </span>
            )}
          </div>
          {description && (
            <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{description}</p>
          )}
          {isVisible && children && <div className="mt-3 animate-slide-up">{children}</div>}
        </div>
      </div>
    </div>
  );
}

function PollingBar() {
  const t = useT();
  return (
    <div
      className="flex animate-fade-in items-center gap-3 rounded-xl border border-accent/15 bg-accent/5 px-4 py-3"
      aria-live="polite"
      role="status"
    >
      <div className="relative shrink-0">
        <Zap className="h-4 w-4 text-accent/70" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-5 animate-pulse rounded-full border border-accent/25" />
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-text-secondary">
          {t('onboarding.listening')}
          <span className="ml-0.5 inline-flex text-text-muted">
            <span className="animate-pulse">...</span>
          </span>
        </p>
        <p className="mt-0.5 text-[11px] text-text-muted">{t('onboarding.willAutoConnect')}</p>
      </div>
    </div>
  );
}

interface OnboardingGuideProps {
  isPolling?: boolean;
}

export const OnboardingGuide = ({ isPolling }: OnboardingGuideProps) => {
  const t = useT();
  const primary = isDev ? 'npm run --prefix gitnexus serve' : 'npx gitnexus@latest serve';
  const termLabel = isDev ? t('onboarding.startBackend') : t('onboarding.terminal');

  const step1State: StepState = isPolling ? 'done' : 'active';
  const step2State: StepState = isPolling ? 'active' : 'waiting';
  const step3State: StepState = 'waiting';

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
          <h2 className="text-lg leading-snug font-semibold text-text-primary">
            {t('onboarding.startServer')}
          </h2>
          <p className="mx-auto mt-1 max-w-xs text-sm leading-relaxed text-text-secondary">
            {isDev ? t('onboarding.devSubtitle') : t('onboarding.prodSubtitle')}
          </p>
        </div>
      </div>

      <div className="relative space-y-5">
        <div
          className="pointer-events-none absolute top-6 bottom-6 left-[11px] w-px bg-border-subtle"
          aria-hidden="true"
        />

        <StepRow
          state={step1State}
          number={1}
          title={t('onboarding.copyCommand')}
          description={isPolling ? undefined : t('onboarding.clickToCopy')}
        >
          <TerminalWindow command={primary} label={termLabel} isActive={step1State === 'active'} />

          {!isDev && (
            <>
              <div className="my-3 flex items-center gap-3">
                <div className="h-px flex-1 bg-border-subtle" />
                <span className="text-[11px] tracking-widest text-text-muted uppercase">
                  {t('onboarding.orInstallGlobally')}
                </span>
                <div className="h-px flex-1 bg-border-subtle" />
              </div>
              <TerminalWindow
                command="npm install -g gitnexus && gitnexus serve"
                label={t('onboarding.globalInstall')}
                isActive={false}
              />
            </>
          )}
        </StepRow>

        <StepRow
          state={step2State}
          number={2}
          title={isPolling ? t('onboarding.waitingForServer') : t('onboarding.pasteAndRun')}
          description={isPolling ? undefined : t('onboarding.openTerminal')}
        >
          {isPolling && <PollingBar />}
        </StepRow>

        <StepRow
          state={step3State}
          number={3}
          title={t('onboarding.autoConnect')}
          description={t('onboarding.autoConnectDesc')}
        />
      </div>

      <div className="mt-6 flex items-center justify-center gap-1.5 border-t border-border-subtle pt-5 text-xs text-text-muted">
        <Server className="h-3 w-3 shrink-0" />
        <span>
          {t('onboarding.requiresNode')}{' '}
          <a
            href="https://nodejs.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent transition-colors hover:text-accent/80 hover:underline"
          >
            Node.js {REQUIRED_NODE_VERSION}+
          </a>
        </span>
        <span className="mx-1 text-border-default">·</span>
        <Terminal className="h-3 w-3 shrink-0" />
        <span>{t('onboarding.port')}</span>
      </div>
    </div>
  );
};
