
export const PSEUDONYMIZATION_VERSION = 'local-pseudonymization-v1';

const escRe = (value) => String(value).replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');

export function createPseudonymVault() {
  const entries = [];
  const byKey = new Map();
  const counters = new Map();

  function tokenFor(value, category = 'DATO') {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const key = category + '::' + raw;
    if (byKey.has(key)) return byKey.get(key);
    const next = (counters.get(category) || 0) + 1;
    counters.set(category, next);
    const token = '[' + category + '_' + String(next).padStart(3, '0') + ']';
    const entry = Object.freeze({ token, value: raw, category });
    entries.push(entry);
    byKey.set(key, token);
    return token;
  }

  function replaceLiteral(text, value, category = 'DATO', { caseInsensitive = false } = {}) {
    const raw = String(value || '').trim();
    if (!raw) return String(text);
    const token = tokenFor(raw, category);
    return String(text).replace(new RegExp(escRe(raw), caseInsensitive ? 'gi' : 'g'), token);
  }

  function replaceRegex(text, regex, category, pick = (groups) => groups[0]) {
    if (!(regex instanceof RegExp)) throw new Error('PSEUDONYM_REGEX_REQUIRED');
    const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
    const re = new RegExp(regex.source, flags);
    return String(text).replace(re, (...args) => {
      const groups = args.slice(0, -2);
      const match = groups[0];
      const chosen = pick(groups);
      if (!chosen) return match;
      const token = tokenFor(chosen, category);
      return match.replace(chosen, token);
    });
  }

  function restoreString(text) {
    let out = String(text);
    for (const entry of [...entries].sort((a, b) => b.token.length - a.token.length)) {
      out = out.split(entry.token).join(entry.value);
    }
    return out;
  }

  function restore(value) {
    if (typeof value === 'string') return restoreString(value);
    if (Array.isArray(value)) return value.map(restore);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restore(v)]));
    }
    return value;
  }

  function manifest() {
    const counts = {};
    for (const entry of entries) counts[entry.category] = (counts[entry.category] || 0) + 1;
    return Object.freeze({
      mode: 'pseudonymized',
      version: PSEUDONYMIZATION_VERSION,
      replacements: Object.freeze({ ...counts }),
      total_replacements: entries.length,
      mapping_shared: false
    });
  }

  return Object.freeze({
    replaceLiteral,
    replaceRegex,
    restore,
    restoreString,
    manifest,
    tokenFor,
    entries: () => Object.freeze(entries.map((entry) => ({ ...entry })))
  });
}

export function detectDirectIdentifiers(text) {
  const source = String(text || '');
  const patterns = [
    ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
    ['iban_es', /\bES\d{2}(?:[\s-]?\d{4}){5}\b/i],
    ['dni_nie', /\b(?:\d{8}|[XYZ]\d{7})[-\s]?[A-Z]\b/i],
    ['telefono_es', /(?<!\d)(?:\+34[\s.-]?)?(?:[6789]\d{2})(?:[\s.-]?\d{3}){2}(?!\d)/],
    ['nss', /\b\d{2}[\s/-]?\d{8}[\s/-]?\d{2}\b/]
  ];
  return patterns.filter(([, re]) => re.test(source)).map(([kind]) => kind);
}
