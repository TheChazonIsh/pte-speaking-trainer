import { DANGEROUS_OBJ_KEYS } from '../config/constants.js';

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeHttpUrl(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return '#';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
    return '#';
  } catch (e) {
    return '#';
  }
}

const ALLOWED_SVG_NAMED_COLORS = new Set([
  'black', 'white', 'gray', 'grey', 'red', 'blue', 'green', 'yellow',
  'orange', 'purple', 'pink', 'teal', 'cyan', 'indigo', 'navy', 'slate',
  'emerald', 'amber', 'rose', 'sky', 'violet', 'none', 'transparent', 'currentcolor'
]);

export function sanitizeSvgColor(color, fallback = '#0284c7') {
  const raw = String(color ?? '').trim();
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw)) return raw;
  if (/^var\(--[a-zA-Z0-9_-]+\)$/.test(raw)) return raw;
  if (ALLOWED_SVG_NAMED_COLORS.has(raw.toLowerCase())) return raw;
  return fallback;
}

export function isSafeObjKey(k) {
  return typeof k === 'string' && k.length > 0 && !DANGEROUS_OBJ_KEYS.has(k);
}

export function stripDangerousKeys(val, depth = 0) {
  if (depth > 12 || val === null || val === undefined) return val;
  if (Array.isArray(val)) {
    return val.map(item => stripDangerousKeys(item, depth + 1));
  }
  if (typeof val === 'object') {
    const out = {};
    Object.keys(val).forEach(k => {
      if (isSafeObjKey(k)) {
        out[k] = stripDangerousKeys(val[k], depth + 1);
      }
    });
    return out;
  }
  return val;
}
