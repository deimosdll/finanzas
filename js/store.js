// Guardado de datos en el dispositivo (IndexedDB, con localStorage de respaldo).
// Todo el estado es un solo objeto JSON. Más adelante se sincroniza con la nube.

const DB_NAME = 'finanzas';
const STORE = 'kv';
const KEY = 'state';
const LS_KEY = 'finanzas-state';
export const VERSION = 1;

export function emptyState() {
  return {
    version: VERSION,
    settings: {
      usdRate: 4000,   // precio del dólar en COP
      usdAuto: true,   // true = se actualiza solo con el cambio real (js/rates.js)
      usdUpdatedAt: null,
      minimo: 50000,   // si después de un gasto te queda menos que esto, el veredicto es "Justo"
      name: '',        // cómo te saluda la app
    },
    accounts: [],
    incomes: [],
    fixed: [],
    debts: [],
    budgets: [],
    goals: [],
    movements: [],
    quincenas: {},
    updatedAt: Date.now(),
  };
}

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

let dbPromise = null;
function openDb() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('sin IndexedDB'));
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function idb(mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  }));
}

// Completa campos que falten (por si el formato cambia entre versiones).
export function normalize(raw) {
  const base = emptyState();
  const s = { ...base, ...raw, settings: { ...base.settings, ...(raw?.settings || {}) } };
  for (const k of ['accounts', 'incomes', 'fixed', 'debts', 'budgets', 'goals', 'movements']) {
    if (!Array.isArray(s[k])) s[k] = [];
  }
  if (!s.quincenas || typeof s.quincenas !== 'object') s.quincenas = {};
  s.version = VERSION;
  return s;
}

export async function load() {
  try {
    const v = await idb('readonly', st => st.get(KEY));
    if (v) return normalize(v);
  } catch { /* sigue con localStorage */ }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch { /* sin datos guardados */ }
  return emptyState();
}

let timer = null;
let pending = null;
export function save(state) {
  pending = state;
  clearTimeout(timer);
  timer = setTimeout(flush, 250);
}

export async function flush() {
  if (!pending) return;
  const snapshot = JSON.parse(JSON.stringify(pending));
  pending = null;
  try {
    await idb('readwrite', st => st.put(snapshot, KEY));
  } catch {
    try { localStorage.setItem(LS_KEY, JSON.stringify(snapshot)); } catch { /* sin espacio */ }
  }
}

// Pide al navegador que no borre los datos si le falta espacio.
export function askPersistence() {
  try { navigator.storage?.persist?.(); } catch { /* no disponible */ }
}

export function exportJson(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `finanzas-respaldo-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function parseImport(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !('quincenas' in data) || !Array.isArray(data.accounts)) {
    throw new Error('Este archivo no parece un respaldo de Finanzas.');
  }
  return normalize(data);
}
