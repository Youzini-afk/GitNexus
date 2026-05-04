import express from 'express';
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  COOKIE_NAME,
  LoginRateLimiter,
  SESSION_TTL_MS,
  SessionStore,
  installAuth,
  loginPageHtml,
  normalizeNextPath,
  parseAuthPassword,
  parseCookies,
  resolveLoginLocale,
  verifyPassword,
} from '../../src/server/auth.js';

const originalPassword = process.env.GITNEXUS_AUTH_PASSWORD;

afterEach(() => {
  if (originalPassword === undefined) {
    delete process.env.GITNEXUS_AUTH_PASSWORD;
  } else {
    process.env.GITNEXUS_AUTH_PASSWORD = originalPassword;
  }
});

type TestResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
};

type RequestOptions = {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string | object;
};

const request = (app: express.Express, options: RequestOptions = {}): Promise<TestResponse> =>
  new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const body =
        typeof options.body === 'object'
          ? JSON.stringify(options.body)
          : typeof options.body === 'string'
            ? options.body
            : undefined;
      const headers = { ...(options.headers ?? {}) };
      if (body !== undefined && !headers['Content-Length']) {
        headers['Content-Length'] = String(Buffer.byteLength(body));
      }
      if (body !== undefined && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: (server.address() as any).port,
          method: options.method ?? 'GET',
          path: options.path ?? '/',
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          res.on('end', () => {
            server.close();
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        },
      );
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      if (body !== undefined) req.write(body);
      req.end();
    });
  });

const setCookieHeader = (response: TestResponse): string => {
  const header = response.headers['set-cookie'];
  return Array.isArray(header) ? header[0] : (header ?? '');
};

const cookiePair = (response: TestResponse): string => setCookieHeader(response).split(';')[0];

const createProtectedApp = (password: string | null) => {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '10mb' }));
  app.options('*', (_req, res) => res.sendStatus(204));
  const cleanup = installAuth(app, password);
  app.all('/api/mcp', (_req, res) => res.json({ ok: 'mcp' }));
  app.get('/api/info', (_req, res) => res.json({ ok: true }));
  app.get('/', (_req, res) => res.type('html').send('<div id="root"></div>'));
  app.get('/assets/app.js', (_req, res) => res.type('js').send('console.log("ok")'));
  return { app, cleanup };
};

describe('parseAuthPassword', () => {
  it('returns null when the env var is absent', () => {
    delete process.env.GITNEXUS_AUTH_PASSWORD;
    expect(parseAuthPassword()).toBeNull();
  });

  it('returns the trimmed password when configured', () => {
    process.env.GITNEXUS_AUTH_PASSWORD = ' secret ';
    expect(parseAuthPassword()).toBe('secret');
  });

  it('throws when the env var is empty', () => {
    process.env.GITNEXUS_AUTH_PASSWORD = '';
    expect(() => parseAuthPassword()).toThrow('GITNEXUS_AUTH_PASSWORD');
  });

  it('throws when the env var only contains whitespace', () => {
    process.env.GITNEXUS_AUTH_PASSWORD = '   ';
    expect(() => parseAuthPassword()).toThrow('GITNEXUS_AUTH_PASSWORD');
  });
});

describe('verifyPassword', () => {
  it('accepts matching passwords', () => {
    expect(verifyPassword('secret', 'secret')).toBe(true);
  });

  it('rejects non-matching passwords', () => {
    expect(verifyPassword('wrong', 'secret')).toBe(false);
  });
});

describe('SessionStore', () => {
  it('creates and verifies opaque sessions', () => {
    const store = new SessionStore(SESSION_TTL_MS);
    const token = store.create();
    try {
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(20);
      expect(store.has(token)).toBe(true);
    } finally {
      store.close();
    }
  });

  it('deletes sessions', () => {
    const store = new SessionStore();
    const token = store.create();
    try {
      store.delete(token);
      expect(store.has(token)).toBe(false);
    } finally {
      store.close();
    }
  });

  it('expires sessions lazily', () => {
    let now = 1_000;
    const store = new SessionStore(100, () => now);
    const token = store.create();
    try {
      expect(store.has(token)).toBe(true);
      now += 101;
      expect(store.has(token)).toBe(false);
    } finally {
      store.close();
    }
  });
});

describe('LoginRateLimiter', () => {
  it('allows failures within the limit and blocks after the limit', () => {
    const limiter = new LoginRateLimiter(2, 60_000, () => 1_000);
    try {
      expect(limiter.isLimited('ip')).toBe(false);
      expect(limiter.recordFailure('ip')).toBe(false);
      expect(limiter.isLimited('ip')).toBe(false);
      expect(limiter.recordFailure('ip')).toBe(false);
      expect(limiter.isLimited('ip')).toBe(true);
      expect(limiter.recordFailure('ip')).toBe(true);
    } finally {
      limiter.close();
    }
  });

  it('resets after the window elapses', () => {
    let now = 1_000;
    const limiter = new LoginRateLimiter(1, 60_000, () => now);
    try {
      expect(limiter.recordFailure('ip')).toBe(false);
      expect(limiter.recordFailure('ip')).toBe(true);
      expect(limiter.isLimited('ip')).toBe(true);
      now += 60_001;
      expect(limiter.isLimited('ip')).toBe(false);
      expect(limiter.recordFailure('ip')).toBe(false);
    } finally {
      limiter.close();
    }
  });
});

describe('cookie and login helpers', () => {
  it('parses cookies from a Cookie header', () => {
    const cookies = parseCookies(`${COOKIE_NAME}=abc; theme=dark`);
    expect(cookies.get(COOKIE_NAME)).toBe('abc');
    expect(cookies.get('theme')).toBe('dark');
  });

  it('normalizes unsafe next paths to root', () => {
    expect(normalizeNextPath('https://evil.example.com')).toBe('/');
    expect(normalizeNextPath('//evil.example.com')).toBe('/');
    expect(normalizeNextPath('/api/auth/status')).toBe('/');
    expect(normalizeNextPath('/clusters')).toBe('/clusters');
  });

  it('renders a server login page with a password form and design tokens', () => {
    const html = loginPageHtml('Invalid <password>', '/clusters');
    expect(html).toContain('type="password"');
    expect(html).toContain('action="/api/auth/login"');
    expect(html).toContain('#06060a');
    expect(html).toContain('#7c3aed');
    expect(html).toContain('Invalid &lt;password&gt;');
    expect(html).toContain('value="/clusters"');
  });

  it('renders a Chinese login page when requested', () => {
    const html = loginPageHtml('密码错误。', '/clusters', 'zh');
    expect(html).toContain('<html lang="zh-CN" data-lang="zh">');
    expect(html).toContain('GitNexus 登录');
    expect(html).toContain('输入部署密码以继续。');
    expect(html).toContain('密码错误。');
    expect(html).toContain('解锁 GitNexus');
    expect(html).toContain('name="lang" value="zh"');
  });

  it('keeps raw and escaped next paths separate in login links', () => {
    const html = loginPageHtml('', '/clusters?tab=a&filter=b');
    expect(html).toContain('value="/clusters?tab=a&amp;filter=b"');
    expect(html).toContain('href="/login?next=%2Fclusters%3Ftab%3Da%26filter%3Db&amp;lang=zh"');
  });

  it('resolves login locale from Accept-Language', () => {
    expect(resolveLoginLocale('zh-CN,zh;q=0.9,en;q=0.8')).toBe('zh');
    expect(resolveLoginLocale('en-US,en;q=0.9,zh;q=0.8')).toBe('en');
    expect(resolveLoginLocale('en-US;q=0.6,zh-CN;q=0.9')).toBe('zh');
    expect(resolveLoginLocale('en-US,en;q=0.9')).toBe('en');
    expect(resolveLoginLocale(undefined)).toBe('en');
  });
});

describe('installAuth', () => {
  it('reports disabled auth and lets protected routes pass when password is absent', async () => {
    const { app, cleanup } = createProtectedApp(null);
    try {
      const status = await request(app, { path: '/api/auth/status' });
      expect(JSON.parse(status.body)).toEqual({ enabled: false, authenticated: true });

      const info = await request(app, { path: '/api/info' });
      expect(info.status).toBe(200);
    } finally {
      cleanup();
    }
  });

  it('blocks API and MCP routes without a valid session', async () => {
    const { app, cleanup } = createProtectedApp('secret');
    try {
      const info = await request(app, { path: '/api/info' });
      expect(info.status).toBe(401);
      expect(JSON.parse(info.body)).toEqual({ error: 'Authentication required', authenticated: false });

      const mcp = await request(app, { method: 'POST', path: '/api/mcp', body: {} });
      expect(mcp.status).toBe(401);
    } finally {
      cleanup();
    }
  });

  it('redirects browser navigations to the login page and rejects assets', async () => {
    const { app, cleanup } = createProtectedApp('secret');
    try {
      const root = await request(app, { path: '/', headers: { Accept: 'text/html' } });
      expect(root.status).toBe(302);
      expect(root.headers.location).toBe('/login?next=%2F');

      const asset = await request(app, { path: '/assets/app.js' });
      expect(asset.status).toBe(401);
      expect(asset.body).toBe('Authentication required');
    } finally {
      cleanup();
    }
  });

  it('serves the public login page', async () => {
    const { app, cleanup } = createProtectedApp('secret');
    try {
      const response = await request(app, { path: '/login?next=/clusters', headers: { Accept: 'text/html' } });
      expect(response.status).toBe(200);
      expect(response.body).toContain('GitNexus');
      expect(response.body).toContain('value="/clusters"');
    } finally {
      cleanup();
    }
  });

  it('serves the public login page in Chinese from lang query', async () => {
    const { app, cleanup } = createProtectedApp('secret');
    try {
      const response = await request(app, { path: '/login?next=/clusters&lang=zh', headers: { Accept: 'text/html' } });
      expect(response.status).toBe(200);
      expect(response.body).toContain('GitNexus 登录');
      expect(response.body).toContain('value="/clusters"');
    } finally {
      cleanup();
    }
  });

  it('preserves selected Chinese locale after a failed HTML login', async () => {
    const { app, cleanup } = createProtectedApp('secret');
    try {
      const response = await request(app, {
        method: 'POST',
        path: '/api/auth/login',
        headers: { Accept: 'text/html', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'password=wrong&next=%2Fclusters&lang=zh',
      });
      expect(response.status).toBe(401);
      expect(response.body).toContain('<html lang="zh-CN" data-lang="zh">');
      expect(response.body).toContain('密码错误。');
      expect(response.body).toContain('value="/clusters"');
      expect(response.body).toContain('name="lang" value="zh"');
    } finally {
      cleanup();
    }
  });

  it('sets an HttpOnly SameSite cookie on JSON login success', async () => {
    const { app, cleanup } = createProtectedApp('secret');
    try {
      const login = await request(app, {
        method: 'POST',
        path: '/api/auth/login',
        headers: { 'X-Forwarded-Proto': 'https' },
        body: { password: 'secret' },
      });
      expect(login.status).toBe(200);
      expect(JSON.parse(login.body)).toEqual({ authenticated: true });
      const cookie = setCookieHeader(login);
      expect(cookie).toContain(`${COOKIE_NAME}=`);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain('Max-Age=86400');
      expect(cookie).toContain('Secure');

      const info = await request(app, { path: '/api/info', headers: { Cookie: cookiePair(login) } });
      expect(info.status).toBe(200);
    } finally {
      cleanup();
    }
  });

  it('redirects HTML login success to next path', async () => {
    const { app, cleanup } = createProtectedApp('secret');
    try {
      const login = await request(app, {
        method: 'POST',
        path: '/api/auth/login',
        headers: { Accept: 'text/html', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'password=secret&next=%2Fclusters',
      });
      expect(login.status).toBe(303);
      expect(login.headers.location).toBe('/clusters');
      expect(setCookieHeader(login)).toContain(`${COOKIE_NAME}=`);
    } finally {
      cleanup();
    }
  });

  it('rejects wrong passwords and rate-limits repeated failures', async () => {
    const { app, cleanup } = createProtectedApp('secret');
    try {
      for (let i = 0; i < 5; i++) {
        const response = await request(app, {
          method: 'POST',
          path: '/api/auth/login',
          body: { password: 'wrong' },
        });
        expect(response.status).toBe(401);
      }

      const limited = await request(app, {
        method: 'POST',
        path: '/api/auth/login',
        body: { password: 'wrong' },
      });
      expect(limited.status).toBe(429);
    } finally {
      cleanup();
    }
  });

  it('rejects the correct password while a client is locked out', async () => {
    const { app, cleanup } = createProtectedApp('secret');
    try {
      for (let i = 0; i < 5; i++) {
        await request(app, {
          method: 'POST',
          path: '/api/auth/login',
          body: { password: 'wrong' },
        });
      }

      const response = await request(app, {
        method: 'POST',
        path: '/api/auth/login',
        body: { password: 'secret' },
      });
      expect(response.status).toBe(429);
      expect(setCookieHeader(response)).toBe('');
    } finally {
      cleanup();
    }
  });

  it('counts oversized password fields as failed attempts before hashing', async () => {
    const { app, cleanup } = createProtectedApp('secret');
    try {
      const response = await request(app, {
        method: 'POST',
        path: '/api/auth/login',
        body: { password: 'x'.repeat(4097) },
      });
      expect(response.status).toBe(401);
      expect(JSON.parse(response.body)).toEqual({ error: 'Invalid password' });
    } finally {
      cleanup();
    }
  });

  it('logs out by revoking the session and clearing the cookie', async () => {
    const { app, cleanup } = createProtectedApp('secret');
    try {
      const login = await request(app, {
        method: 'POST',
        path: '/api/auth/login',
        body: { password: 'secret' },
      });
      const cookie = cookiePair(login);

      const logout = await request(app, {
        method: 'POST',
        path: '/api/auth/logout',
        headers: { Cookie: cookie },
      });
      expect(logout.status).toBe(200);
      expect(setCookieHeader(logout)).toContain('Max-Age=0');

      const info = await request(app, { path: '/api/info', headers: { Cookie: cookie } });
      expect(info.status).toBe(401);
    } finally {
      cleanup();
    }
  });

  it('allows OPTIONS requests before auth-protected routes', async () => {
    const { app, cleanup } = createProtectedApp('secret');
    try {
      const response = await request(app, { method: 'OPTIONS', path: '/api/info' });
      expect(response.status).toBe(204);
    } finally {
      cleanup();
    }
  });

  it('rejects cross-origin login attempts', async () => {
    const { app, cleanup } = createProtectedApp('secret');
    try {
      const response = await request(app, {
        method: 'POST',
        path: '/api/auth/login',
        headers: { Origin: 'https://evil.example.com', Host: 'gitnexus.example.com' },
        body: { password: 'secret' },
      });
      expect(response.status).toBe(403);
    } finally {
      cleanup();
    }
  });
});
