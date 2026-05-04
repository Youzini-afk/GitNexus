import crypto from 'node:crypto';
import express from 'express';

export const AUTH_PASSWORD_ENV = 'GITNEXUS_AUTH_PASSWORD';
export const COOKIE_NAME = 'gitnexus_sid';
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const PASSWORD_COMPARE_KEY = crypto.randomBytes(32);
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const MAX_PASSWORD_LENGTH = 4096;

type Clock = () => number;

type SessionRecord = {
  expiresAt: number;
};

type RateLimitRecord = {
  count: number;
  windowStartedAt: number;
};

type LoginLocale = 'en' | 'zh';

type LoginCopy = {
  lang: string;
  title: string;
  subtitle: string;
  passwordLabel: string;
  unlockButton: string;
  switchLanguage: string;
  invalidPassword: string;
};

export type AuthCleanup = () => void;

export function parseAuthPassword(): string | null {
  const rawPassword = process.env[AUTH_PASSWORD_ENV];
  if (rawPassword === undefined) return null;

  const password = rawPassword.trim();
  if (!password) {
    throw new Error(`${AUTH_PASSWORD_ENV} must not be empty when set`);
  }

  return password;
}

const digestPassword = (password: string): Buffer =>
  crypto.createHmac('sha256', PASSWORD_COMPARE_KEY).update(password).digest();

export function verifyPassword(candidate: string, configured: string): boolean {
  const candidateDigest = digestPassword(candidate);
  const configuredDigest = digestPassword(configured);
  return crypto.timingSafeEqual(candidateDigest, configuredDigest);
}

const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly cleanupTimer: NodeJS.Timeout | null;

  constructor(
    private readonly ttlMs = SESSION_TTL_MS,
    private readonly now: Clock = Date.now,
    cleanupIntervalMs = Math.min(SESSION_TTL_MS, 60 * 60 * 1000),
  ) {
    this.cleanupTimer = setInterval(() => this.deleteExpired(), cleanupIntervalMs);
    this.cleanupTimer.unref?.();
  }

  create(): string {
    const token = crypto.randomBytes(32).toString('base64url');
    this.sessions.set(hashToken(token), { expiresAt: this.now() + this.ttlMs });
    return token;
  }

  has(token: string | undefined): boolean {
    if (!token) return false;

    const key = hashToken(token);
    const session = this.sessions.get(key);
    if (!session) return false;

    if (session.expiresAt <= this.now()) {
      this.sessions.delete(key);
      return false;
    }

    return true;
  }

  delete(token: string | undefined): void {
    if (!token) return;
    this.sessions.delete(hashToken(token));
  }

  deleteExpired(): void {
    const now = this.now();
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(key);
      }
    }
  }

  close(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.sessions.clear();
  }
}

export class LoginRateLimiter {
  private readonly attempts = new Map<string, RateLimitRecord>();

  constructor(
    private readonly maxAttempts = RATE_LIMIT_MAX_ATTEMPTS,
    private readonly windowMs = RATE_LIMIT_WINDOW_MS,
    private readonly now: Clock = Date.now,
  ) {}

  private activeRecord(key: string): RateLimitRecord | null {
    const record = this.attempts.get(key);
    if (!record) return null;

    if (this.now() - record.windowStartedAt >= this.windowMs) {
      this.attempts.delete(key);
      return null;
    }

    return record;
  }

  isLimited(key: string): boolean {
    const record = this.activeRecord(key);
    return record !== null && record.count >= this.maxAttempts;
  }

  recordFailure(key: string): boolean {
    const now = this.now();
    const record = this.activeRecord(key);

    if (!record) {
      this.attempts.set(key, { count: 1, windowStartedAt: now });
      return false;
    }

    record.count += 1;
    return record.count > this.maxAttempts;
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }

  close(): void {
    this.attempts.clear();
  }
}

const decodeCookieValue = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch (err) {
    if (process.env.DEBUG) {
      console.warn('[auth] failed to decode cookie value:', err instanceof Error ? err.message : err);
    }
    return value;
  }
};

export function parseCookies(cookieHeader: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!cookieHeader) return cookies;

  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValueParts] = part.trim().split('=');
    if (!rawName || rawValueParts.length === 0) continue;
    cookies.set(rawName, decodeCookieValue(rawValueParts.join('=')));
  }

  return cookies;
}

const sessionTokenFromRequest = (req: express.Request): string | undefined =>
  parseCookies(req.headers.cookie).get(COOKIE_NAME);

const isSecureRequest = (req: express.Request): boolean => {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  return req.secure || proto?.split(',')[0]?.trim() === 'https';
};

const sessionCookie = (token: string, req: express.Request): string => {
  const attributes = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isSecureRequest(req)) attributes.push('Secure');
  return attributes.join('; ');
};

const clearSessionCookie = (req: express.Request): string => {
  const attributes = [`${COOKIE_NAME}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (isSecureRequest(req)) attributes.push('Secure');
  return attributes.join('; ');
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const LOGIN_COPY: Record<LoginLocale, LoginCopy> = {
  en: {
    lang: 'en',
    title: 'GitNexus Login',
    subtitle: 'Enter the deployment password to continue.',
    passwordLabel: 'Password',
    unlockButton: 'Unlock GitNexus',
    switchLanguage: '中文',
    invalidPassword: 'Invalid password.',
  },
  zh: {
    lang: 'zh-CN',
    title: 'GitNexus 登录',
    subtitle: '输入部署密码以继续。',
    passwordLabel: '密码',
    unlockButton: '解锁 GitNexus',
    switchLanguage: 'English',
    invalidPassword: '密码错误。',
  },
};

export function resolveLoginLocale(acceptLanguage: unknown): LoginLocale {
  const header = Array.isArray(acceptLanguage) ? acceptLanguage.join(',') : acceptLanguage;
  if (typeof header !== 'string') return 'en';

  const candidates = header
    .split(',')
    .map((part, index) => {
      const [range = '', ...params] = part.trim().split(';');
      const primary = range.trim().toLowerCase().split('-')[0];
      const qValue = params
        .map((param) => param.trim())
        .find((param) => param.toLowerCase().startsWith('q='))
        ?.slice(2);
      const parsedQ = qValue === undefined ? 1 : Number(qValue);
      const q = Number.isFinite(parsedQ) ? parsedQ : 1;
      return { primary, q, index };
    })
    .filter((candidate) => (candidate.primary === 'en' || candidate.primary === 'zh') && candidate.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);

  return candidates[0]?.primary === 'zh' ? 'zh' : 'en';
}

const normalizeLoginLocale = (value: unknown, fallback: LoginLocale): LoginLocale =>
  value === 'zh' || value === 'en' ? value : fallback;

export function normalizeNextPath(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.startsWith('/api/auth/')) return '/';
  return value;
}

export function loginPageHtml(message = '', next = '/', locale: LoginLocale = 'en'): string {
  const copy = LOGIN_COPY[locale];
  const safeMessage = message ? `<div class="error">${escapeHtml(message)}</div>` : '';
  const normalizedNext = normalizeNextPath(next);
  const safeNext = escapeHtml(normalizedNext);
  const nextLocale = locale === 'zh' ? 'en' : 'zh';
  const toggleHref = escapeHtml(`/login?next=${encodeURIComponent(normalizedNext)}&lang=${nextLocale}`);

  return `<!DOCTYPE html>
<html lang="${copy.lang}" data-lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(copy.title)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Outfit,system-ui,-apple-system,sans-serif;background:#06060a;color:#e4e4ed;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem}
.card{background:#101018;border:1px solid #2a2a3a;border-radius:0.75rem;padding:2rem;max-width:420px;width:100%;box-shadow:0 24px 80px rgba(0,0,0,.35)}
.logo{font-size:1.5rem;font-weight:700;letter-spacing:-0.02em;margin-bottom:0.25rem}
.subtitle{font-size:0.875rem;color:#8888a0;margin-bottom:1.5rem}
label{display:block;font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#8888a0;margin-bottom:0.5rem}
input[type=password]{width:100%;background:#0a0a10;border:1px solid #2a2a3a;border-radius:0.5rem;color:#e4e4ed;padding:0.75rem 0.875rem;font:inherit;outline:none}
input[type=password]:focus{border-color:#7c3aed;box-shadow:0 0 0 3px rgba(124,58,237,.18)}
button{width:100%;margin-top:1rem;background:#7c3aed;color:white;border:0;border-radius:0.5rem;padding:0.75rem 0.875rem;font:inherit;font-weight:700;cursor:pointer}
button:hover{background:#6d28d9}
.locale-toggle{display:block;margin-top:1rem;text-align:center;color:#8888a0;text-decoration:none;font-size:.8125rem}
.locale-toggle:hover{color:#e4e4ed;text-decoration:underline}
.error{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.35);color:#fecaca;border-radius:0.5rem;padding:0.75rem;margin-bottom:1rem;font-size:0.875rem}
</style>
</head>
<body>
<main class="card">
  <div class="logo">GitNexus</div>
  <div class="subtitle">${escapeHtml(copy.subtitle)}</div>
  ${safeMessage}
  <form method="post" action="/api/auth/login">
    <input type="hidden" name="next" value="${safeNext}">
    <input type="hidden" name="lang" value="${locale}">
    <label for="password">${escapeHtml(copy.passwordLabel)}</label>
    <input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
    <button type="submit">${escapeHtml(copy.unlockButton)}</button>
  </form>
  <a class="locale-toggle" href="${toggleHref}">${escapeHtml(copy.switchLanguage)}</a>
</main>
</body>
</html>`;
}

const requestOrigin = (req: express.Request): string => {
  const host = req.get('host') ?? '';
  const protoHeader = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader;
  const protocol = proto?.split(',')[0]?.trim() || req.protocol;
  return `${protocol}://${host}`;
};

const hasSameOrigin = (req: express.Request): boolean => {
  const origin = req.get('origin');
  if (!origin) return true;
  return origin === requestOrigin(req);
};

const wantsHtml = (req: express.Request): boolean => {
  const accept = req.get('accept') ?? '';
  return accept.includes('text/html') && !accept.includes('application/json');
};

const readPasswordBody = (body: unknown): { password: string; next: string } => {
  const objectBody =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  return {
    password: typeof objectBody.password === 'string' ? objectBody.password : '',
    next: normalizeNextPath(objectBody.next),
  };
};

const writeNoStore = (res: express.Response): void => {
  res.setHeader('Cache-Control', 'no-store');
};

const rateLimitKeyFromRequest = (req: express.Request): string =>
  req.socket.remoteAddress || req.ip || 'unknown';

export function installAuth(app: express.Express, password: string | null): AuthCleanup {
  const sessions = new SessionStore();
  const limiter = new LoginRateLimiter();
  const authEnabled = password !== null;

  app.get('/api/auth/status', (req, res) => {
    writeNoStore(res);
    res.json({ enabled: authEnabled, authenticated: !authEnabled || sessions.has(sessionTokenFromRequest(req)) });
  });

  if (!authEnabled) {
    return () => {
      sessions.close();
      limiter.close();
    };
  }

  app.get('/login', (req, res) => {
    writeNoStore(res);
    const locale = normalizeLoginLocale(req.query.lang, resolveLoginLocale(req.headers['accept-language']));
    res.type('html').send(loginPageHtml('', normalizeNextPath(req.query.next), locale));
  });

  app.post('/api/auth/login', express.urlencoded({ extended: false, limit: '100kb' }), (req, res) => {
    writeNoStore(res);

    if (!hasSameOrigin(req)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const rateLimitKey = rateLimitKeyFromRequest(req);
    if (limiter.isLimited(rateLimitKey)) {
      res.status(429).json({ error: 'Too many login attempts' });
      return;
    }

    const { password: candidate, next } = readPasswordBody(req.body);

    if (candidate.length > MAX_PASSWORD_LENGTH) {
      const limited = limiter.recordFailure(rateLimitKey);
      res.status(limited ? 429 : 401).json({ error: limited ? 'Too many login attempts' : 'Invalid password' });
      return;
    }

    if (!verifyPassword(candidate, password)) {
      const limited = limiter.recordFailure(rateLimitKey);
      if (limited) {
        res.status(429).json({ error: 'Too many login attempts' });
        return;
      }
      if (wantsHtml(req)) {
        const objectBody = typeof req.body === 'object' && req.body !== null ? req.body as Record<string, unknown> : {};
        const locale = normalizeLoginLocale(objectBody.lang, resolveLoginLocale(req.headers['accept-language']));
        res.status(401).type('html').send(loginPageHtml(LOGIN_COPY[locale].invalidPassword, next, locale));
        return;
      }
      res.status(401).json({ error: 'Invalid password' });
      return;
    }

    limiter.reset(rateLimitKey);
    sessions.delete(sessionTokenFromRequest(req));
    const token = sessions.create();
    res.setHeader('Set-Cookie', sessionCookie(token, req));

    if (wantsHtml(req)) {
      res.redirect(303, next);
      return;
    }

    res.json({ authenticated: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    writeNoStore(res);

    if (!hasSameOrigin(req)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    sessions.delete(sessionTokenFromRequest(req));
    res.setHeader('Set-Cookie', clearSessionCookie(req));
    res.json({ authenticated: false });
  });

  app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
      next();
      return;
    }

    if (sessions.has(sessionTokenFromRequest(req))) {
      next();
      return;
    }

    writeNoStore(res);
    if (req.path.startsWith('/api/')) {
      res.status(401).json({ error: 'Authentication required', authenticated: false });
      return;
    }

    if (req.method === 'GET' && wantsHtml(req)) {
      res.redirect(302, `/login?next=${encodeURIComponent(normalizeNextPath(req.originalUrl))}`);
      return;
    }

    res.status(401).type('text').send('Authentication required');
  });

  return () => {
    sessions.close();
    limiter.close();
  };
}
