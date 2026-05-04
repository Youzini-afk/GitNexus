import { describe, expect, it } from 'vitest';
import { enDictionary, resolveLocalePreference, tp, zhDictionary } from '../../src/i18n';
import type { Dictionary } from '../../src/i18n';

const collectPaths = (value: unknown, prefix = ''): string[] => {
  if (typeof value === 'string') return [prefix];
  if (!value || typeof value !== 'object') return [];

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectPaths(child, prefix ? `${prefix}.${key}` : key),
  );
};

describe('i18n dictionaries', () => {
  it('keeps English and Chinese dictionaries in sync', () => {
    expect(collectPaths(zhDictionary).sort()).toEqual(collectPaths(enDictionary).sort());
  });

  it('interpolates placeholders', () => {
    expect(tp(enDictionary, 'header.nodes', { count: 42 })).toBe('42 nodes');
    expect(tp(zhDictionary, 'header.nodes', { count: 42 })).toBe('42 个节点');
  });

  it('falls back to English and then the raw key', () => {
    const incomplete = { header: {} } as Dictionary;
    expect(tp(incomplete, 'header.searchPlaceholder')).toBe('Search nodes...');
    expect(tp(incomplete, 'header.missing' as never)).toBe('header.missing');
  });
});

describe('resolveLocalePreference', () => {
  it('uses a valid stored preference first', () => {
    expect(resolveLocalePreference('zh', 'en-US')).toBe('zh');
    expect(resolveLocalePreference('en', 'zh-CN')).toBe('en');
  });

  it('falls back to browser language and then English', () => {
    expect(resolveLocalePreference(null, 'zh-CN')).toBe('zh');
    expect(resolveLocalePreference('fr', 'ko-KR')).toBe('en');
  });
});
