import { describe, expect, it, vi } from 'vitest';

const importFreshConstants = async () => {
  vi.resetModules();
  return import('../../src/config/ui-constants');
};

describe('DEFAULT_BACKEND_URL', () => {
  it('defaults to same-origin for single-service deployments', async () => {
    vi.stubGlobal('window', {
      location: {
        protocol: 'https:',
        origin: 'https://gitnexus.example.com',
      },
    });

    const { DEFAULT_BACKEND_URL } = await importFreshConstants();

    expect(DEFAULT_BACKEND_URL).toBe('https://gitnexus.example.com');
  });

  it('falls back to localhost for file origins', async () => {
    vi.stubGlobal('window', {
      location: {
        protocol: 'file:',
        origin: 'file://',
      },
    });

    const { DEFAULT_BACKEND_URL } = await importFreshConstants();

    expect(DEFAULT_BACKEND_URL).toBe('http://localhost:4747');
  });
});
