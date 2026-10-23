import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { createTranslator, resolveLocale } from '../server/i18n.js';

const I18nContext = createContext(null);
export const LANGUAGE_KEY = 'locade.language';

function initialPreference() {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    return ['en', 'zh-CN'].includes(saved) ? saved : 'auto';
  } catch {
    return 'auto';
  }
}

export function I18nProvider({ children }) {
  const [preference, setPreference] = useState(initialPreference);
  const locale = resolveLocale(
    preference,
    navigator.languages || [navigator.language],
  );
  const t = useMemo(() => createTranslator(locale), [locale]);
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.title = t('Locade / 本地项目游乐场');
  }, [locale, t]);
  const value = useMemo(
    () => ({
      locale,
      preference,
      t,
      setLanguage(next) {
        if (!['auto', 'en', 'zh-CN'].includes(next)) return;
        setPreference(next);
        try {
          if (next === 'auto') localStorage.removeItem(LANGUAGE_KEY);
          else localStorage.setItem(LANGUAGE_KEY, next);
        } catch {
          /* A language change must work even if storage is blocked. */
        }
      },
    }),
    [locale, preference, t],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('I18nProvider is required');
  return context;
}

export function LanguagePicker() {
  const { t, preference, setLanguage } = useI18n();
  return (
    <label className="language-picker">
      <span>{t('语言')}</span>
      <select
        aria-label="Language / 语言"
        value={preference}
        onChange={(event) => setLanguage(event.target.value)}
      >
        <option value="auto">{t('跟随浏览器')}</option>
        <option value="en">English</option>
        <option value="zh-CN">简体中文</option>
      </select>
    </label>
  );
}

export function formatLocalDate(value, locale, fallback, options) {
  return value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat(
        locale,
        options || {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        },
      ).format(new Date(value))
    : fallback;
}
