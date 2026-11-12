import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserLanguage, language, locale, setLanguage, t } from '../src/i18n';

afterEach(() => {
  vi.unstubAllGlobals();
  setLanguage('ru');
});

describe('i18n', () => {
  it('interpolates variables and keeps unknown placeholders visible', () => {
    expect(t('countSummary', { visible: 1, total: 2 })).toBe('1 из 2 cookies');
    expect(t('countSummary', { visible: 1 })).toBe('1 из {total} cookies');
  });
  it('switches language explicitly', () => {
    setLanguage('en');
    expect(language()).toBe('en');
    expect(locale()).toBe('en-US');
    expect(t('save')).toBe('Save');
  });
  it('follows the browser language in auto mode', () => {
    vi.stubGlobal('chrome', { i18n: { getUILanguage: () => 'ru-RU' } });
    expect(setLanguage('auto')).toBe('ru');
    vi.stubGlobal('chrome', { i18n: { getUILanguage: () => 'de' } });
    expect(browserLanguage()).toBe('en');
    expect(setLanguage('auto')).toBe('en');
  });
});
