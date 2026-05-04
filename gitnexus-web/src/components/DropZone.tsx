import { useState, useRef, useEffect } from 'react';
import { Loader2, Check, Sparkles } from '@/lib/lucide-icons';
import {
  connectToServer,
  fetchRepos,
  type ConnectResult,
  type BackendRepo,
} from '../services/backend-client';
import { useBackend } from '../hooks/useBackend';
import { OnboardingGuide } from './OnboardingGuide';
import { AnalyzeOnboarding } from './AnalyzeOnboarding';
import { RepoLanding } from './RepoLanding';
import { useT } from '../i18n';
import { LanguageSwitcher } from './LanguageSwitcher';

interface DropZoneProps {
  onServerConnect?: (result: ConnectResult, serverUrl?: string) => void | Promise<void>;
}

function Crossfade({ activeKey, children }: { activeKey: string; children: React.ReactNode }) {
  const [displayedKey, setDisplayedKey] = useState(activeKey);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const snapshotRef = useRef<React.ReactNode>(children);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!isTransitioning && activeKey === displayedKey) {
    snapshotRef.current = children;
  }

  useEffect(() => {
    if (activeKey !== displayedKey) {
      setIsTransitioning(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        snapshotRef.current = null;
        setDisplayedKey(activeKey);
        setIsTransitioning(false);
      }, 300);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [activeKey, displayedKey]);

  return (
    <div
      className="transition-[opacity,transform] duration-300 ease-out"
      style={{
        opacity: isTransitioning ? 0 : 1,
        transform: isTransitioning ? 'scale(0.97) translateY(8px)' : 'scale(1) translateY(0)',
      }}
    >
      {isTransitioning ? snapshotRef.current : children}
    </div>
  );
}

function SuccessCard() {
  const t = useT();
  return (
    <div
      className="relative overflow-hidden rounded-3xl border border-emerald-500/20 bg-surface p-7"
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-none absolute -top-20 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-emerald-500/8 blur-3xl" />
      <div className="relative">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 shadow-[0_0_30px_rgba(16,185,129,0.15)]">
          <Check className="h-8 w-8 text-emerald-400" />
        </div>
        <h2 className="mb-2 text-center text-lg font-semibold text-emerald-400">
          {t('dropZone.serverConnected')}
        </h2>
        <p className="text-center text-sm leading-relaxed text-text-secondary">
          {t('dropZone.preparingGraph')}
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400/60"
                style={{ animationDelay: `${i * 200}ms` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingCard({ message }: { message: string }) {
  const t = useT();
  return (
    <div
      className="relative overflow-hidden rounded-3xl border border-accent/20 bg-surface p-7"
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-none absolute -top-20 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-accent/8 blur-3xl" />
      <div className="relative">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/20 to-accent-dim/10 shadow-glow-soft">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
        <h2 className="mb-2 text-center text-lg font-semibold text-text-primary">
          {message || t('dropZone.connecting')}
        </h2>
        <p className="text-center text-sm leading-relaxed text-text-secondary">
          {t('dropZone.largeRepoNote')}
        </p>
        <div className="mt-5 flex items-center justify-center">
          <Sparkles className="h-4 w-4 text-accent/30" />
        </div>
      </div>
    </div>
  );
}

export const DropZone = ({ onServerConnect }: DropZoneProps) => {
  const t = useT();
  const [error, setError] = useState<string | null>(null);

  const {
    isConnected,
    isProbing,
    startPolling,
    stopPolling,
    isPolling,
    backendUrl: detectedBackendUrl,
  } = useBackend();
  const [initialProbeComplete, setInitialProbeComplete] = useState(false);
  const autoConnectRan = useRef(false);
  const autoConnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [phase, setPhase] = useState<'onboarding' | 'analyze' | 'landing' | 'success' | 'loading'>(
    'onboarding',
  );
  const [loadingMessage, setLoadingMessage] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const [detectedRepos, setDetectedRepos] = useState<BackendRepo[]>([]);

  const handleAutoConnect = async () => {
    setPhase('loading');
    setLoadingMessage(t('dropZone.connecting'));
    setError(null);

    try {
      const repos = await fetchRepos();
      if (repos.length === 0) {
        setPhase('analyze');
        autoConnectRan.current = false;
        return;
      }
      setDetectedRepos(repos);
      setPhase('landing');
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const message = err instanceof Error ? err.message : t('dropZone.failedToConnect');
      setError(message);
      setPhase('onboarding');
    }
  };

  const handleAutoConnectRef = useRef(handleAutoConnect);
  handleAutoConnectRef.current = handleAutoConnect;

  const connectToRepo = (repoName: string) => {
    autoConnectRan.current = true;
    setPhase('loading');
    setLoadingMessage(t('loadingOverlay.processing'));
    setError(null);

    (async () => {
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      try {
        const result = await connectToServer(
          detectedBackendUrl,
          (p, downloaded, total) => {
            if (p === 'validating') {
              setLoadingMessage(t('dropZone.validatingServer'));
            } else if (p === 'downloading') {
              const pct = total ? Math.round((downloaded / total) * 100) : null;
              const mb = (downloaded / (1024 * 1024)).toFixed(1);
              setLoadingMessage(
                pct ? `${t('dropZone.downloadingGraph')} ${pct}%` : `${t('dropZone.downloadingGraph')} ${mb} MB`,
              );
            } else if (p === 'extracting') {
              setLoadingMessage(t('dropZone.processingGraph'));
            }
          },
          abortController.signal,
          repoName,
        );
        if (onServerConnect) {
          await onServerConnect(result, detectedBackendUrl);
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : t('dropZone.unknownError'));
        setPhase(detectedRepos.length > 0 ? 'landing' : 'analyze');
      } finally {
        abortControllerRef.current = null;
      }
    })();
  };

  useEffect(() => {
    if (!isProbing && !initialProbeComplete) {
      setInitialProbeComplete(true);
    }
  }, [isProbing, initialProbeComplete]);

  useEffect(() => {
    if (initialProbeComplete && !isConnected && !isPolling && !autoConnectRan.current) {
      startPolling();
    }
  }, [initialProbeComplete, isConnected, isPolling, startPolling]);

  useEffect(() => {
    if (isConnected && !autoConnectRan.current) {
      autoConnectRan.current = true;
      stopPolling();
      setPhase('success');
      autoConnectTimerRef.current = setTimeout(() => {
        autoConnectTimerRef.current = null;
        handleAutoConnectRef.current();
      }, 1200);
    }
    if (!isConnected && autoConnectRan.current && !isProbing) {
      autoConnectRan.current = false;
      if (autoConnectTimerRef.current !== null) {
        clearTimeout(autoConnectTimerRef.current);
        autoConnectTimerRef.current = null;
      }
      setPhase('onboarding');
      setError(null);
    }
  }, [isConnected, isProbing, stopPolling]);

  useEffect(() => {
    return () => {
      if (autoConnectTimerRef.current !== null) clearTimeout(autoConnectTimerRef.current);
      abortControllerRef.current?.abort();
    };
  }, []);

  const displayPhase = !initialProbeComplete ? null : phase;

  return (
    <div className="flex min-h-screen items-center justify-center bg-void p-8">
      <div className="fixed top-4 right-4 z-10 rounded-lg border border-border-subtle bg-surface/80 backdrop-blur">
        <LanguageSwitcher />
      </div>
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute top-1/4 left-1/4 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        <div className="absolute right-1/4 bottom-1/4 h-96 w-96 rounded-full bg-node-interface/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-lg">
        {error && (
          <div className="mb-4 animate-fade-in rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-center text-sm text-red-400">
            {error}
          </div>
        )}

        {displayPhase && (
          <Crossfade activeKey={displayPhase}>
            {displayPhase === 'onboarding' && <OnboardingGuide isPolling={isPolling} />}
            {displayPhase === 'analyze' && <AnalyzeOnboarding onComplete={connectToRepo} />}
            {displayPhase === 'landing' && (
              <RepoLanding
                repos={detectedRepos}
                onSelectRepo={connectToRepo}
                onAnalyzeComplete={connectToRepo}
              />
            )}
            {displayPhase === 'success' && <SuccessCard />}
            {displayPhase === 'loading' && <LoadingCard message={loadingMessage} />}
          </Crossfade>
        )}
      </div>
    </div>
  );
};
