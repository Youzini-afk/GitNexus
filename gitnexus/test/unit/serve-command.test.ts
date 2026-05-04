import { afterEach, describe, expect, it } from 'vitest';
import { resolveServeOptions } from '../../src/cli/serve.js';

const originalPort = process.env.PORT;

afterEach(() => {
  if (originalPort === undefined) {
    delete process.env.PORT;
  } else {
    process.env.PORT = originalPort;
  }
});

describe('resolveServeOptions', () => {
  it('keeps localhost and port 4747 as local defaults', () => {
    delete process.env.PORT;

    expect(resolveServeOptions()).toEqual({ port: 4747, host: 'localhost' });
  });

  it('uses Zeabur-style PORT env and binds all interfaces', () => {
    process.env.PORT = '3000';

    expect(resolveServeOptions()).toEqual({ port: 3000, host: '0.0.0.0' });
  });

  it('lets explicit CLI options override environment defaults', () => {
    process.env.PORT = '3000';

    expect(resolveServeOptions({ port: '4748', host: '127.0.0.1' })).toEqual({
      port: 4748,
      host: '127.0.0.1',
    });
  });
});
