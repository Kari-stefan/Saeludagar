import fs from 'node:fs';

export const LANGUAGES = ['is', 'en'];
export const DEFAULT_LANGUAGE = 'is';

function load(lang) {
  return JSON.parse(fs.readFileSync(new URL(`./${lang}.json`, import.meta.url), 'utf8'));
}

export const dictionaries = Object.fromEntries(LANGUAGES.map((lang) => [lang, load(lang)]));

function lookup(dict, key) {
  const value = key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), dict);
  return typeof value === 'string' ? value : undefined;
}

// Missing English strings fall back to Icelandic, then to the key itself.
export function t(lang, key, params = {}) {
  const text = lookup(dictionaries[lang], key) ?? lookup(dictionaries[DEFAULT_LANGUAGE], key) ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

export function translator(lang) {
  return (key, params) => t(lang, key, params);
}

// Dates in the §11 formats: "11. mars 2027, kl. 10:00" / "11 March 2027, 10:00". Iceland is UTC+0
// all year, so stored UTC values are also local time.
const LOCALES = { is: 'is-IS', en: 'en-GB' };
const dateFormats = Object.fromEntries(LANGUAGES.map((lang) => [lang, new Intl.DateTimeFormat(LOCALES[lang], {
  timeZone: 'Atlantic/Reykjavik', day: 'numeric', month: 'long', year: 'numeric',
})]));
const timeFormats = Object.fromEntries(LANGUAGES.map((lang) => [lang, new Intl.DateTimeFormat(LOCALES[lang], {
  timeZone: 'Atlantic/Reykjavik', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})]));

// day is 'YYYY-MM-DD'.
export function formatDate(lang, day) {
  return dateFormats[lang].format(new Date(`${day}T12:00:00Z`));
}

// iso is an ISO-8601 UTC timestamp.
export function formatDateTime(lang, iso) {
  const date = new Date(iso);
  return t(lang, 'format.dateTime', { date: dateFormats[lang].format(date), time: timeFormats[lang].format(date) });
}

// "kl. 10:00–12:00" / "10:00–12:00"; start and end are 'HH:MM'.
export function formatTimeRange(lang, start, end) {
  return t(lang, 'format.timeRange', { start, end });
}

// BR-26: "2.500 kr." / "ISK 2,500", and "Ókeypis" / "Free" for 0.
const numberFormats = Object.fromEntries(LANGUAGES.map((lang) => [lang, new Intl.NumberFormat(LOCALES[lang])]));
export function formatFee(lang, isk) {
  return isk === 0 ? t(lang, 'format.free') : t(lang, 'format.fee', { amount: numberFormats[lang].format(isk) });
}

// BR-60: in English, an event's English title or description if there is one, else the Icelandic.
export function eventText(lang, event, field) {
  return (lang === 'en' && event[`${field}_en`]) || event[`${field}_is`];
}
