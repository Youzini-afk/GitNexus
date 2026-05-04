/**
 * Unit Tests: CORS origin allowlist
 *
 * Tests isAllowedOrigin() from server/api.ts, which controls which HTTP
 * Origins are permitted by the Express CORS middleware.
 *
 * Policy:
 *   - No origin (non-browser)         → allowed
 *   - http://localhost:<port>          → allowed
 *   - http://127.0.0.1:<port>         → allowed
 *   - RFC 1918 private network ranges → allowed
 *       10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 *   - https://gitnexus.vercel.app     → allowed
 *   - Everything else                 → rejected
 */
import { afterEach, describe, it, expect } from 'vitest';
import { isAllowedOrigin } from '../../src/server/api.js';

const originalCorsOrigins = process.env.GITNEXUS_CORS_ORIGINS;
const originalCorsOrigin = process.env.GITNEXUS_CORS_ORIGIN;

afterEach(() => {
  if (originalCorsOrigins === undefined) {
    delete process.env.GITNEXUS_CORS_ORIGINS;
  } else {
    process.env.GITNEXUS_CORS_ORIGINS = originalCorsOrigins;
  }

  if (originalCorsOrigin === undefined) {
    delete process.env.GITNEXUS_CORS_ORIGIN;
  } else {
    process.env.GITNEXUS_CORS_ORIGIN = originalCorsOrigin;
  }
});

// ─── No origin (non-browser / curl) ──────────────────────────────────

describe('isAllowedOrigin: no origin', () => {
  it('allows undefined origin (curl, server-to-server)', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
  });
});

// ─── Localhost variants ───────────────────────────────────────────────

describe('isAllowedOrigin: localhost', () => {
  it('allows http://localhost:3000', () => {
    expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
  });

  it('allows http://localhost:5173 (Vite default)', () => {
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
  });

  it('allows http://localhost:8080', () => {
    expect(isAllowedOrigin('http://localhost:8080')).toBe(true);
  });

  it('allows http://127.0.0.1:3000', () => {
    expect(isAllowedOrigin('http://127.0.0.1:3000')).toBe(true);
  });

  it('allows http://127.0.0.1:5173', () => {
    expect(isAllowedOrigin('http://127.0.0.1:5173')).toBe(true);
  });
});

// ─── Deployed site ────────────────────────────────────────────────────

describe('isAllowedOrigin: vercel.app', () => {
  it('allows https://gitnexus.vercel.app', () => {
    expect(isAllowedOrigin('https://gitnexus.vercel.app')).toBe(true);
  });

  it('rejects other vercel.app subdomains', () => {
    expect(isAllowedOrigin('https://evil.vercel.app')).toBe(false);
  });
});

// ─── Operator-configured origins ──────────────────────────────────────

describe('isAllowedOrigin: configured origins', () => {
  it('allows origins configured through GITNEXUS_CORS_ORIGINS', () => {
    process.env.GITNEXUS_CORS_ORIGINS =
      'https://gitnexus-web.example.com, https://gitnexus.zeabur.app/';

    expect(isAllowedOrigin('https://gitnexus-web.example.com')).toBe(true);
    expect(isAllowedOrigin('https://gitnexus.zeabur.app')).toBe(true);
  });

  it('allows origins configured through legacy singular GITNEXUS_CORS_ORIGIN', () => {
    process.env.GITNEXUS_CORS_ORIGIN = 'https://single-origin.example.com';

    expect(isAllowedOrigin('https://single-origin.example.com')).toBe(true);
  });

  it('normalizes configured origins to exact origins only', () => {
    process.env.GITNEXUS_CORS_ORIGINS = 'https://gitnexus.example.com/app/path';

    expect(isAllowedOrigin('https://gitnexus.example.com')).toBe(true);
    expect(isAllowedOrigin('https://evil.example.com')).toBe(false);
  });
});

// ─── RFC 1918: 10.0.0.0/8 ────────────────────────────────────────────

describe('isAllowedOrigin: 10.x.x.x (RFC 1918, /8)', () => {
  it('allows http://10.0.0.1:3000', () => {
    expect(isAllowedOrigin('http://10.0.0.1:3000')).toBe(true);
  });

  it('allows http://10.1.2.3:5173', () => {
    expect(isAllowedOrigin('http://10.1.2.3:5173')).toBe(true);
  });

  it('allows http://10.255.255.255:8080', () => {
    expect(isAllowedOrigin('http://10.255.255.255:8080')).toBe(true);
  });
});

// ─── RFC 1918: 172.16.0.0/12 ─────────────────────────────────────────

describe('isAllowedOrigin: 172.16-31.x.x (RFC 1918, /12)', () => {
  it('allows http://172.16.0.1:3000 (lower bound)', () => {
    expect(isAllowedOrigin('http://172.16.0.1:3000')).toBe(true);
  });

  it('allows http://172.20.1.2:3000 (middle of range)', () => {
    expect(isAllowedOrigin('http://172.20.1.2:3000')).toBe(true);
  });

  it('allows http://172.31.255.255:3000 (upper bound)', () => {
    expect(isAllowedOrigin('http://172.31.255.255:3000')).toBe(true);
  });

  it('rejects http://172.15.0.1:3000 (below range)', () => {
    expect(isAllowedOrigin('http://172.15.0.1:3000')).toBe(false);
  });

  it('rejects http://172.32.0.1:3000 (above range)', () => {
    expect(isAllowedOrigin('http://172.32.0.1:3000')).toBe(false);
  });
});

// ─── RFC 1918: 192.168.0.0/16 ────────────────────────────────────────

describe('isAllowedOrigin: 192.168.x.x (RFC 1918, /16)', () => {
  it('allows http://192.168.0.1:3000 (typical home router gateway)', () => {
    expect(isAllowedOrigin('http://192.168.0.1:3000')).toBe(true);
  });

  it('allows http://192.168.1.100:5173', () => {
    expect(isAllowedOrigin('http://192.168.1.100:5173')).toBe(true);
  });

  it('allows http://192.168.255.254:8080', () => {
    expect(isAllowedOrigin('http://192.168.255.254:8080')).toBe(true);
  });

  it('rejects http://192.167.1.1:3000 (adjacent, not private)', () => {
    expect(isAllowedOrigin('http://192.167.1.1:3000')).toBe(false);
  });

  it('rejects http://192.169.1.1:3000 (adjacent, not private)', () => {
    expect(isAllowedOrigin('http://192.169.1.1:3000')).toBe(false);
  });
});

// ─── Public / untrusted origins ───────────────────────────────────────

describe('isAllowedOrigin: rejected origins', () => {
  it('rejects https://evil.com', () => {
    expect(isAllowedOrigin('https://evil.com')).toBe(false);
  });

  it('rejects https://example.com', () => {
    expect(isAllowedOrigin('https://example.com')).toBe(false);
  });

  it('rejects http://8.8.8.8:3000 (Google DNS, public IP)', () => {
    expect(isAllowedOrigin('http://8.8.8.8:3000')).toBe(false);
  });

  it('rejects https://gitnexus.example.com (not the official domain)', () => {
    expect(isAllowedOrigin('https://gitnexus.example.com')).toBe(false);
  });

  it('rejects malformed origin string', () => {
    expect(isAllowedOrigin('not-a-url')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isAllowedOrigin('')).toBe(false);
  });

  // Localhost without explicit port (port 80 implied)
  it('allows http://localhost without port', () => {
    expect(isAllowedOrigin('http://localhost')).toBe(true);
  });

  it('allows http://127.0.0.1 without port', () => {
    expect(isAllowedOrigin('http://127.0.0.1')).toBe(true);
  });

  // IPv6 loopback
  it('allows IPv6 loopback http://[::1]:3000', () => {
    expect(isAllowedOrigin('http://[::1]:3000')).toBe(true);
  });

  it('allows IPv6 loopback http://[::1] without port', () => {
    expect(isAllowedOrigin('http://[::1]')).toBe(true);
  });

  // Protocol validation
  it('rejects non-HTTP(S) origins from private IPs', () => {
    expect(isAllowedOrigin('ftp://10.0.0.1')).toBe(false);
    expect(isAllowedOrigin('ftp://192.168.1.1')).toBe(false);
  });

  it('allows HTTP and HTTPS from private IPs', () => {
    expect(isAllowedOrigin('http://192.168.1.100')).toBe(true);
    expect(isAllowedOrigin('https://10.0.0.50')).toBe(true);
    expect(isAllowedOrigin('http://172.16.5.1:3000')).toBe(true);
  });
});
