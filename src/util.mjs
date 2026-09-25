// Utilidades deterministas: canonicalización JSON, hash, importes en céntimos y fechas.
// Mismo criterio que justicia_aeroport (knowledge/contracts.mjs): claves ordenadas + SHA-256.
import { sha256Hex } from './sha256-sync.mjs';

export const arr = (v) => (Array.isArray(v) ? v : []);
export const obj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
export const text = (v) => (typeof v === 'string' ? v.trim() : '');

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!obj(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonicalize(value[k])]));
}

export const canonicalJson = (value) => JSON.stringify(canonicalize(value));
export const hash = (value) => sha256Hex(typeof value === 'string' ? value : canonicalJson(value));

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

// ---- Importes: siempre en céntimos enteros para evitar errores de coma flotante ----
export function aCentimos(euros) {
  const n = Number(euros);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function formatoEuros(centimos) {
  const negativo = centimos < 0;
  const abs = Math.abs(centimos);
  const enteros = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dec = String(abs % 100).padStart(2, '0');
  return `${negativo ? '-' : ''}${enteros},${dec} €`;
}

// ---- Fechas ISO (AAAA-MM-DD) ----
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function fechaValida(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(iso))) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function fechaLarga(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${y}`;
}

export function fechaCorta(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export const ORDINALES = ['Primero', 'Segundo', 'Tercero', 'Cuarto', 'Quinto', 'Sexto', 'Séptimo', 'Octavo', 'Noveno', 'Décimo'];
export const ordinal = (i) => ORDINALES[i] || `${i + 1}.º`;
