// Nube (Supabase): cuenta, sincronización entre dispositivos y bandeja de los Atajos de Apple.
// Sin librerías: llamadas directas a la API REST de Supabase.
//
// Cómo sincroniza:
// - Cada cambio marca "pendiente" y se sube a los 2 segundos.
// - Al abrir la app (y cada minuto mientras está abierta) revisa si la nube cambió.
//   Si cambió y aquí no hay nada pendiente, trae lo de la nube. Si ambos cambiaron, los junta.
// - Los gastos que llegan de los Atajos esperan en "atajos_inbox" hasta que la app los recoge.

import { normalize } from './store.js';
import { qOf, qTitle, qShift, build, ensureRec } from './quincena.js';
import { today, fmtDate } from './money.js';

export const SUPABASE_URL = 'https://ihmpzymyjlgskebtpmvq.supabase.co';
// Llave pública ("publishable"): está hecha para ir dentro de la app. Los datos los protege la cuenta.
export const SUPABASE_KEY = 'sb_publishable_2EtNj3kprt5YbSvK562aeQ_4YtdV6Bl';

const SESSION_KEY = 'finanzas-session';
const META_KEY = 'finanzas-sync';

const read = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin espacio */ } };

let session = read(SESSION_KEY);
export const meta = read(META_KEY) || { syncedAt: null, dirty: false, lastSync: null, shortcutKey: null, error: null };
const saveMeta = () => write(META_KEY, meta);

export const isLoggedIn = () => !!session?.refresh_token;
export const userEmail = () => session?.user?.email || '';

// ---------- API ----------

async function api(path, { method = 'GET', body, auth = true, prefer } = {}) {
  const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
  if (auth) {
    const token = await accessToken();
    if (!token) throw new Error('Tu sesión se cerró. Vuelve a entrar en Cuentas → Nube.');
    headers.Authorization = `Bearer ${token}`;
  }
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(SUPABASE_URL + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data?.msg || data?.message || data?.error_description || data?.error || `Error ${res.status}`;
    throw new Error(translate(msg));
  }
  return data;
}

function translate(msg) {
  const m = String(msg);
  if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/email not confirmed/i.test(m)) return 'Primero confirma tu correo: abre el enlace que te llegó.';
  if (/already registered|already exists/i.test(m)) return 'Ese correo ya tiene cuenta. Usa "Entrar".';
  if (/password should be at least/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres.';
  if (/signups not allowed|signup is disabled/i.test(m)) return 'Los registros nuevos están cerrados en tu Supabase.';
  if (/relation .* does not exist|could not find the table/i.test(m)) return 'Falta crear las tablas en Supabase (el paso del SQL).';
  if (/failed to fetch|network/i.test(m)) return 'Sin conexión a internet.';
  return m;
}

// ---------- Sesión ----------

function keepSession(s) {
  session = {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600),
    user: { id: s.user?.id, email: s.user?.email },
  };
  write(SESSION_KEY, session);
}

let refreshing = null;
async function accessToken() {
  if (!session) return null;
  if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
  refreshing ??= api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: session.refresh_token } })
    .then(s => { keepSession(s); return s.access_token; })
    .catch(e => { if (!/conexión/.test(e.message)) logoutLocal(); return null; })
    .finally(() => { refreshing = null; });
  return refreshing;
}

export async function signUp(email, password) {
  const r = await api('/auth/v1/signup', { method: 'POST', auth: false, body: { email, password } });
  if (r?.access_token) { keepSession(r); return { session: true }; }
  return { session: false }; // hay que confirmar el correo
}

export async function signIn(email, password) {
  keepSession(await api('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email, password } }));
}

function logoutLocal() {
  session = null;
  write(SESSION_KEY, null);
  Object.assign(meta, { syncedAt: null, dirty: false, lastSync: null, shortcutKey: null, error: null });
  saveMeta();
}

export async function signOut() {
  try { await api('/auth/v1/logout', { method: 'POST' }); } catch { /* igual se cierra aquí */ }
  logoutLocal();
}

// ---------- Datos ----------

async function fetchRemote() {
  const rows = await api('/rest/v1/finanzas?select=data,updated_at,shortcut_key');
  return rows?.[0] || null;
}

async function fetchInbox() {
  return await api('/rest/v1/atajos_inbox?select=id,movement&order=id') || [];
}

async function clearInbox(ids) {
  if (!ids.length) return;
  await api(`/rest/v1/atajos_inbox?id=in.(${ids.join(',')})`, { method: 'DELETE' });
}

// Lo que leen los Atajos: libre de la quincena, presupuestos y próximos pagos.
export function summaryOf(s) {
  const t = today();
  const b = build(s, qOf(t));
  return {
    quincena: qTitle(b.q),
    libre: b.totals.libre,
    minimo: Number(s.settings.minimo) || 0,
    budgets: b.budgets.map(x => ({ id: x.id, name: x.name, left: x.left })),
    next: b.payments.filter(p => !p.done && p.date >= t).sort((a, c) => a.date.localeCompare(c.date)).slice(0, 3)
      .map(p => ({ concept: p.concept, amount: p.amount, fecha: fmtDate(p.date) })),
    // Para el lector de SMS: lo planeado que aún no está hecho (quincena anterior, actual y siguiente).
    ...pendingOf(s, b.q),
    at: new Date().toISOString(),
  };
}

function pendingOf(s, q) {
  const pending = [];
  const incoming = [];
  const done = []; // ya marcado a mano: si llega el SMS, no se anota dos veces
  for (const qq of [qShift(q, -1), q, qShift(q, 1)]) {
    const b = build(s, qq);
    const pick = x => ({ key: x.key, q: qq, concept: x.concept, amount: x.amount, date: x.date });
    pending.push(...b.payments.filter(p => !p.done).map(pick));
    incoming.push(...b.incomes.filter(i => !i.done).map(pick));
    done.push(...[...b.payments, ...b.incomes, ...b.gastos.map(g => ({ ...g, key: `mov:${g.id}` }))].filter(x => x.done !== false).map(pick));
  }
  return { pending, incoming, done };
}

// Lo que llega de la bandeja: gastos/ingresos nuevos, o "marcar como hecho" algo planeado.
function applyInbox(state, rows) {
  const notes = [];
  const have = new Set(state.movements.map(m => m.id));
  for (const { movement: m } of rows) {
    if (m.type === 'check' && m.key.startsWith('mov:')) {
      // Pago o ingreso "de una sola vez": el estado vive en el movimiento mismo.
      const mov = state.movements.find(x => x.id === m.key.slice(4));
      if (mov) { mov.done = true; mov.separated = false; if (Math.round(m.amount) !== Math.round(mov.amount)) mov.amount = m.amount; }
      notes.push('marcado');
    } else if (m.type === 'check') {
      const rec = ensureRec(state, m.q);
      const c = rec.checks[m.key] ?? {};
      c.done = true;
      c.separated = false;
      if (Math.round(m.amount) !== Math.round(m.planned)) c.amount = m.amount;
      rec.checks[m.key] = c;
      notes.push('pago marcado');
    } else if (!have.has(m.id)) {
      state.movements.push(m);
      notes.push(m.kind === 'ingreso' ? 'ingreso' : 'gasto');
    }
  }
  return notes;
}

// Sube. Si `expected` no coincide con la nube (otro dispositivo cambió algo), devuelve null.
async function push(s, expected, force = false) {
  const body = { data: s, summary: summaryOf(s) };
  if (!expected && !force) {
    const rows = await api('/rest/v1/finanzas', { method: 'POST', body, prefer: 'return=representation' });
    return rows?.[0] || null;
  }
  const uid = session.user.id;
  const cond = force ? '' : `&updated_at=eq.${encodeURIComponent(expected)}`;
  const rows = await api(`/rest/v1/finanzas?user_id=eq.${uid}${cond}`, { method: 'PATCH', body, prefer: 'return=representation' });
  return rows?.[0] || null;
}

// Junta dos versiones: no se pierde nada de ninguna (lo de este dispositivo gana si hay choque).
const byId = (a = [], b = []) => {
  const map = new Map(a.map(x => [x.id, x]));
  for (const x of b) map.set(x.id, x);
  return [...map.values()];
};
function merge(remote, local) {
  const out = { ...remote, ...local, settings: { ...remote.settings, ...local.settings } };
  for (const k of ['accounts', 'incomes', 'fixed', 'debts', 'budgets', 'goals', 'movements']) out[k] = byId(remote[k], local[k]);
  out.quincenas = { ...remote.quincenas };
  for (const [q, rec] of Object.entries(local.quincenas || {})) {
    const r = remote.quincenas?.[q] || {};
    out.quincenas[q] = {
      ...r, ...rec,
      checks: { ...(r.checks || {}), ...(rec.checks || {}) },
      budgetOverrides: { ...(r.budgetOverrides || {}), ...(rec.budgetOverrides || {}) },
      tasks: byId(r.tasks, rec.tasks),
      reserves: byId(r.reserves, rec.reserves),
    };
  }
  return out;
}

// ---------- Sincronizar ----------

let ctxRef = null;
let running = null;
let pushTimer = null;
let listeners = [];

export const onChange = fn => { listeners.push(fn); };
const notify = () => listeners.forEach(fn => fn());

export function init(ctx) {
  ctxRef = ctx;
  if (isLoggedIn()) syncNow();
  setInterval(() => { if (document.visibilityState === 'visible' && isLoggedIn()) syncNow(); }, 60000);
  window.addEventListener('online', () => isLoggedIn() && syncNow());
}

// Lo llama la app en cada cambio.
export function markDirty() {
  if (!isLoggedIn()) return;
  meta.dirty = true;
  saveMeta();
  clearTimeout(pushTimer);
  pushTimer = setTimeout(syncNow, 2000);
}

export function syncNow() {
  if (!isLoggedIn() || !ctxRef) return Promise.resolve(false);
  running ??= doSync().finally(() => { running = null; });
  return running;
}

async function doSync(attempt = 0) {
  const ctx = ctxRef;
  try {
    const remote = await fetchRemote();
    let state = ctx.s;
    let adopted = false;

    if (remote) {
      meta.shortcutKey = remote.shortcut_key;
      if (remote.updated_at !== meta.syncedAt) {
        state = meta.dirty ? merge(normalize(remote.data), state) : normalize(remote.data);
        adopted = true;
      }
    }

    // Gastos que llegaron de los Atajos
    const inbox = remote ? await fetchInbox() : [];
    if (inbox.length) {
      if (!adopted) state = JSON.parse(JSON.stringify(state));
      applyInbox(state, inbox);
      adopted = true;
    }

    if (adopted) ctx.adopt(state);

    const mustPush = !remote || meta.dirty || inbox.length || (adopted && meta.dirty);
    if (mustPush) {
      const row = await push(ctx.s, remote?.updated_at || null);
      if (!row) {
        if (attempt < 2) return doSync(attempt + 1); // otro dispositivo subió algo justo ahora
        throw new Error('No se pudo sincronizar por cambios al mismo tiempo. Intenta de nuevo.');
      }
      meta.syncedAt = row.updated_at;
      meta.shortcutKey = row.shortcut_key;
      await clearInbox(inbox.map(r => r.id));
    } else if (remote) {
      meta.syncedAt = remote.updated_at;
    }

    meta.dirty = false;
    meta.lastSync = Date.now();
    meta.error = null;
    saveMeta();
    notify();
    if (inbox.length) ctx.toast?.(inbox.length === 1 ? 'Llegó 1 movimiento del banco o de Atajos' : `Llegaron ${inbox.length} movimientos del banco o de Atajos`);
    return true;
  } catch (e) {
    meta.error = e.message;
    saveMeta();
    notify();
    return false;
  }
}

// Primer inicio de sesión en un dispositivo: decide qué datos quedan.
export async function firstSync(localHasData, askUseCloud) {
  const remote = await fetchRemote();
  const d = remote?.data || {};
  const remoteHasData = !!(d.accounts?.length || d.incomes?.length || d.fixed?.length || d.debts?.length || d.movements?.length);
  if (!remote) {
    meta.dirty = true; // la nube está vacía: se suben los de este dispositivo
  } else if (localHasData && (!remoteHasData || !askUseCloud())) {
    // La nube no tiene nada útil (o él eligió este dispositivo): se reemplaza con lo de aquí.
    const row = await push(ctxRef.s, null, true); // reemplazar la nube con este dispositivo
    meta.syncedAt = row?.updated_at || null;
    meta.dirty = false;
  } else {
    meta.syncedAt = null; // fuerza a traer la nube
    meta.dirty = false;
  }
  saveMeta();
  return syncNow();
}
