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
