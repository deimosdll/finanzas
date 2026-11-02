// Formatos de plata y fechas (COP, español de Colombia).

export const pad = n => String(n).padStart(2, '0');

const nf = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
const nfUsd = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });

// 1400000 -> "$1.400.000" · -38020 -> "−$38.020"
export function fmt(n) {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '−$' : '$') + nf.format(Math.abs(v));
}

export const fmtUsd = n => 'USD ' + nfUsd.format(Number(n) || 0);

// Número sin signo de pesos, para inputs: 1400000 -> "1.400.000"
export const fmtPlain = n => (n || n === 0) ? nf.format(Math.round(n)) : '';

// Lee lo que escribe la persona. COP: solo dígitos. USD: acepta decimales con coma o punto.
export function parseMoney(text, currency = 'COP') {
  const s = String(text ?? '').trim();
  if (!s) return 0;
  if (currency === 'USD') {
    const clean = s.replace(/[^\d.,]/g, '');
    // "1.234,56" o "1,234.56" o "20,5" -> número
    const lastSep = Math.max(clean.lastIndexOf(','), clean.lastIndexOf('.'));
    if (lastSep === -1) return Number(clean) || 0;
    const int = clean.slice(0, lastSep).replace(/[.,]/g, '');
    const dec = clean.slice(lastSep + 1);
    // Si después del separador hay 3 dígitos, era separador de miles.
    if (dec.length === 3) return Number(int + dec) || 0;
    return Number(`${int}.${dec}`) || 0;
  }
  return Number(s.replace(/\D/g, '')) || 0;
}

// ---- Fechas (siempre como texto 'YYYY-MM-DD', en hora local) ----

export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => iso(new Date());
export function fromIso(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
// m en base 0 (enero = 0)
export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

export const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// '2026-11-03' -> '3 nov'  ·  con año: '3 nov 2026'
export function fmtDate(s, withYear = false) {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  return `${d} ${MESES[m - 1]}${withYear ? ' ' + y : ''}`;
}

// Escapa texto escrito por la persona antes de meterlo en HTML.
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
