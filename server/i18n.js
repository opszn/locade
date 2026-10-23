import { englishMessages } from './ui-messages.js';
import { diagnosticMessages } from './diagnostic-messages.js';

export const messages = Object.freeze({
  ...englishMessages,
  ...diagnosticMessages,
});
export const normalizeLanguage = (value) => {
  if (typeof value !== 'string') return null;
  if (/^zh(?:-[a-z0-9]+)*$/i.test(value)) return 'zh-CN';
  if (/^en(?:-[a-z0-9]+)*$/i.test(value)) return 'en';
  return null;
};

export function resolveLocale(preference, languages = []) {
  if (preference !== 'auto') {
    const explicit = normalizeLanguage(preference);
    if (explicit) return explicit;
  }
  return languages.map(normalizeLanguage).find(Boolean) || 'en';
}
const interpolate = (template, values) =>
  template.replace(/\{(\d+)\}/g, (token, index) =>
    values[index] === undefined ? token : String(values[index]),
  );
const escapePattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const reverse = new Map(
  Object.entries(messages).map(([key, value]) => [value, key]),
);
const patterns = Object.entries(messages)
  .flatMap(([key, english]) => {
    if (!/\{\d+\}/.test(key)) return [];
    return [key, english].map((template) => {
      const indices = [];
      const pattern = template
        .split(/(\{\d+\})/g)
        .map((piece) => {
          if (/^\{\d+\}$/.test(piece)) {
            indices.push(Number(piece.slice(1, -1)));
            return '([\\s\\S]*?)';
          }
          return escapePattern(piece);
        })
        .join('');
      return {
        key,
        indices,
        expression: new RegExp(`^${pattern}$`),
        length: template.length,
      };
    });
  })
  .sort((a, b) => b.length - a.length);

export function translateMessage(message, locale = 'zh-CN', values) {
  if (typeof message !== 'string')
    return message == null ? '' : String(message);
  let key = message;
  if (values === undefined) {
    if (!Object.hasOwn(messages, key)) key = reverse.get(message) || key;
    if (!Object.hasOwn(messages, key)) {
      for (const pattern of patterns) {
        const match = message.match(pattern.expression);
        if (!match) continue;
        const captured = [];
        pattern.indices.forEach((index, position) => {
          captured[index] = match[position + 1];
        });
        return interpolate(
          locale === 'en' ? messages[pattern.key] : pattern.key,
          captured,
        );
      }
      return message;
    }
  }
  return interpolate(
    locale === 'en' ? messages[key] || key : key,
    values || [],
  );
}

export const createTranslator = (locale) => (message, values) =>
  translateMessage(message, locale, values);

export function translateDiagnostic(message, locale) {
  const translated = translateMessage(message, locale);
  if (translated !== message || typeof message !== 'string') return translated;
  return message
    .split('；')
    .map((part) => translateMessage(part, locale))
    .join(locale === 'en' ? '; ' : '；');
}
