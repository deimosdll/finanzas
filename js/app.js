// Arranque de la app: carga los datos, dibuja la pantalla y escucha los toques.

import * as store from './store.js';
import { views, actions, forms, changes, alcanzaResult } from './views.js';
import { wireSheet } from './forms.js';
import { qOf } from './quincena.js';
import { today, fmtPlain } from './money.js';
import { fetchUsdCop, isStale } from './rates.js';

const TABS = [
  { route: 'inicio', label: 'Inicio', icon: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>' },
  { route: 'quincena', label: 'Quincena', icon: '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="19" cy="18" r="2"/>' },
  { route: 'alcanza', label: '¿Alcanza?', icon: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17.5v.01"/>' },
  { route: 'plan', label: 'Plan', icon: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>' },
  { route: 'cuentas', label: 'Cuentas', icon: '<path d="M3 10l9-6 9 6M5 10v8M19 10v8M9 10v8M15 10v8M3 20h18"/>' },
];

const ctx = {
  s: null,
  cur: null, // última quincena calculada (para editar sus líneas)
  ui: {
    route: 'inicio',
    q: qOf(today()),
    af: { text: '', currency: 'COP', budgetId: '', when: 'now' },
  },
  commit(mutate) {
    mutate(ctx.s);
    ctx.s.updatedAt = Date.now();
    store.save(ctx.s);
    ctx.render();
  },
  replace(next) {
    ctx.s = next;
    ctx.s.updatedAt = Date.now();
    store.save(ctx.s);
    ctx.render();
  },
  render,
  refreshRate,
};

// Trae el precio real del dólar. Devuelve true si lo actualizó.
async function refreshRate(force = false) {
  if (!force && !isStale(ctx.s)) return false;
  const v = await fetchUsdCop();
  if (!v) return false;
  ctx.s.settings.usdRate = v;
  ctx.s.settings.usdUpdatedAt = Date.now();
  store.save(ctx.s);
  // No redibuja mientras escribes o tienes un formulario abierto.
  const typing = document.activeElement?.matches?.('input, select, textarea');
  if (!document.getElementById('sheet').open && !typing) render();
  else if (ctx.ui.route === 'alcanza') updateAlcanza();
  return true;
}

const main = document.getElementById('main');
const tabs = document.getElementById('tabs');

function routeFromHash() {
  const r = location.hash.replace('#', '');
  return views[r] ? r : 'inicio';
}

function renderTabs() {
  tabs.innerHTML = `
    <div class="brand">Finanzas</div>
    ${TABS.map(t => `
      <a href="#${t.route}" class="tab" ${ctx.ui.route === t.route ? 'aria-current="page"' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true">${t.icon}</svg><span>${t.label}</span>
      </a>`).join('')}`;
}

function render() {
  const scroll = window.scrollY;
  const sameRoute = main.dataset.route === ctx.ui.route;
  renderTabs();
  main.innerHTML = views[ctx.ui.route](ctx);
  main.dataset.route = ctx.ui.route;
  window.scrollTo(0, sameRoute ? scroll : 0);
}

// Toques en cualquier botón con data-act
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.closest('dialog')) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  fn(ctx, el.dataset, el);
});

document.addEventListener('submit', e => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  forms[form.dataset.form]?.(ctx, form);
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.actChange) changes[el.dataset.actChange]?.(ctx, el);
  if (el.id === 'af-budget') { ctx.ui.af.budgetId = el.value; updateAlcanza(); }
});

// "¿Me alcanza?" se recalcula mientras escribes, sin redibujar toda la pantalla.
document.addEventListener('input', e => {
  const el = e.target;
  if (el.id !== 'af-amount') return;
  if (ctx.ui.af.currency === 'COP') {
    const digits = el.value.replace(/\D/g, '');
    el.value = digits ? fmtPlain(Number(digits)) : '';
  }
  ctx.ui.af.text = el.value;
  updateAlcanza();
});

function updateAlcanza() {
  const box = document.getElementById('af-result');
  if (box) box.innerHTML = alcanzaResult(ctx);
}

window.addEventListener('hashchange', () => {
  ctx.ui.route = routeFromHash();
  render();
});

// Si la app queda abierta y cambia la quincena (o vuelves después de días), salta a la actual.
let lastQ = qOf(today());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') { store.flush(); return; }
  const nowQ = qOf(today());
  if (nowQ !== lastQ) { lastQ = nowQ; ctx.ui.q = nowQ; render(); }
  refreshRate();
});
window.addEventListener('pagehide', () => store.flush());

async function start() {
  wireSheet();
  ctx.s = await store.load();
  ctx.ui.route = routeFromHash();
  render();
  store.askPersistence();
  refreshRate();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sin modo offline */ });
  }
}

start();
