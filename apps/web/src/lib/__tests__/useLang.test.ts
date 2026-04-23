import { describe, expect, it } from 'vitest';
import { getInitialLang, readStoredLang } from '../useLang';

describe('useLang helpers', () => {
  it('uses english for the initial render so SSR and hydration stay aligned', () => {
    expect(getInitialLang()).toBe('en');
  });

  it('reads a persisted chinese preference after hydration', () => {
    expect(readStoredLang('zh')).toBe('zh');
  });

  it('falls back to english for unknown persisted values', () => {
    expect(readStoredLang('unexpected')).toBe('en');
    expect(readStoredLang(null)).toBe('en');
  });
});
