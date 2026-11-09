// Lógica de la plata por quincena. No toca la pantalla: recibe el estado y devuelve números.
//
// Una quincena va del 1 al 15 o del 16 al último día del mes.
// Su id es 'YYYY-MM-1' o 'YYYY-MM-2'.
//
// Sobra = arranque + ingresos − pagos − presupuestos − gastos sin presupuesto
// Libre = Sobra − lo apartado (plata que ya tiene destino)

import { pad, daysInMonth, today, MESES, MESES_LARGO } from './money.js';

// ---------- Fechas de quincena ----------

export function qOf(dateIso) {
  const [y, m, d] = dateIso.split('-').map(Number);
  return `${y}-${pad(m)}-${d < 16 ? 1 : 2}`;
}

export function qParts(id) {
  const [y, m, h] = id.split('-').map(Number);
  return { y, m, h };
}

export function qRange(id) {
  const { y, m, h } = qParts(id);
  const dim = daysInMonth(y, m - 1);
  const sd = h === 1 ? 1 : 16;
  const ed = h === 1 ? 15 : dim;
  return { y, m, h, sd, ed, dim, start: `${y}-${pad(m)}-${pad(sd)}`, end: `${y}-${pad(m)}-${pad(ed)}` };
}

export function qShift(id, n) {
  const { y, m, h } = qParts(id);
  let idx = (y * 12 + (m - 1)) * 2 + (h - 1) + n;
  const hh = idx % 2;
  idx = (idx - hh) / 2;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}-${hh + 1}`;
}

// 'Nov · 1ª quincena'
export function qTitle(id) {
  const { m, h } = qParts(id);
  const mes = MESES_LARGO[m - 1];
  return `${mes[0].toUpperCase()}${mes.slice(1, 3)} · ${h}ª quincena`;
}

// '1 – 15 nov 2026'
export function qSubtitle(id) {
  const r = qRange(id);
  return `${r.sd} – ${r.ed} ${MESES[r.m - 1]} ${r.y}`;
}

// Fecha de un "día del mes" dentro de la quincena, o null si no cae en ella.
// El día 31 en un mes de 30 días se paga el 30.
export function dateFor(day, r) {
  const dd = Math.min(Number(day), r.dim);
  if (!dd || dd < r.sd || dd > r.ed) return null;
  return `${r.y}-${pad(r.m)}-${pad(dd)}`;
}

const inWindow = (date, from, until) => (!from || date >= from) && (!until || date <= until);

// ---------- Ayudas ----------

export const toCop = (amount, currency, s) =>
  currency === 'USD' ? Math.round(Number(amount) * (Number(s.settings.usdRate) || 0)) : Math.round(Number(amount) || 0);

export function ensureRec(s, q) {
  s.quincenas[q] ??= {};
  const rec = s.quincenas[q];
  rec.checks ??= {};
  rec.tasks ??= [];
  rec.reserves ??= [];
  rec.budgetOverrides ??= {};
  return rec;
}

export function isDone(s, key, date) {
  return !!s.quincenas[qOf(date)]?.checks?.[key]?.done;
}

// Tarjeta con día de corte: el pago del 18 nov cubre las compras hasta el corte anterior (28 oct).
export function cardPeriod(d, date) {
  const cut = Number(d.cutDay);
  if (d.mode !== 'pagos' || !cut || !date) return null;
  let [y, m, day] = date.split('-').map(Number);
  if (cut >= day) { m--; if (m < 1) { m = 12; y--; } }
  const cd = Math.min(cut, daysInMonth(y, m - 1));
  return { month: MESES_LARGO[m - 1], cut: `${cd} ${MESES[m - 1]}`, label: `compras de ${MESES_LARGO[m - 1]} (corte ${cd} ${MESES[m - 1]})` };
}

// Todas las fechas de pago de una deuda (de principio a fin).
export function debtSchedule(d) {
  if (d.mode === 'pagos') {
    return (d.payments || [])
      .filter(p => p.date && p.amount)
      .map(p => ({ date: p.date, amount: Number(p.amount), period: cardPeriod(d, p.date) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  // Cuota fija: un pago al mes, el "día", desde el primer pago pendiente hasta el último.
  if (!d.first || !d.until || !d.day) return [];
  const out = [];
  let [y, m] = d.first.split('-').map(Number);
  for (let i = 0; i < 240; i++) {
    const dd = Math.min(Number(d.day), daysInMonth(y, m - 1));
    const date = `${y}-${pad(m)}-${pad(dd)}`;
    if (date > d.until) break;
    if (date >= d.first) out.push({ date, amount: Number(d.amount) || 0 });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

export function debtStatus(s, d) {
  const sched = debtSchedule(d);
  let remaining = 0;
  let next = null;
  let left = 0;
  for (const p of sched) {
    const key = `debt:${d.id}:${p.date}`;
    if (isDone(s, key, p.date)) continue;
    const real = s.quincenas[qOf(p.date)]?.checks?.[key]?.amount;
    remaining += real ?? p.amount;
    left++;
    next ??= p;
  }
  const total = sched.reduce((a, p) => a + p.amount, 0);
  return { remaining, total, paid: Math.max(0, total - remaining), next, left, last: sched.length ? sched[sched.length - 1].date : null, count: sched.length };
}

// ---------- Metas de ahorro ----------

// Lo que tiene ahorrado una meta: lo que ya tenía + aportes marcados como hechos.
export function goalSaved(s, g) {
  let total = Number(g.saved) || 0;
  const prefix = `goal:${g.id}:`;
  for (const rec of Object.values(s.quincenas)) {
    for (const [key, c] of Object.entries(rec.checks || {})) {
      if (!c.done || !key.startsWith(prefix)) continue;
      const src = key.split(':')[2];
      let planned = Number(g.perQuincena) || 0;
      if (src !== 'q') {
        const d = s.debts.find(x => x.id === src);
        planned = Number(d?.redirects?.find(x => x.goalId === g.id)?.amount) || Number(d?.amount) || 0;
      }
      total += c.amount ?? planned;
    }
  }
  for (const m of s.movements) {
    if (m.kind === 'ahorro' && m.goalId === g.id && m.done) total += m.amount;
    if (m.kind === 'ingreso' && m.done && m.pocket === `goal:${g.id}`) total += m.amount;
    if (m.kind === 'mover') {
      if (m.to === `goal:${g.id}`) total += m.amount;
      if (m.from === `goal:${g.id}`) total -= m.amount;
    }
  }
  return total;
}

// Avance de una meta y, si tiene monto, en qué fecha se cumple al ritmo actual.
export function goalStatus(s, g) {
  const saved = goalSaved(s, g);
  const target = Number(g.target) || 0;
  const planned = s.movements
    .filter(m => m.kind === 'ahorro' && m.goalId === g.id && !m.done && m.date >= today())
    .sort((a, b) => a.date.localeCompare(b.date));
  let eta = null;
  if (target > saved) {
    let acc = saved;
    let q = qOf(today());
    for (let i = 0; i < 240 && !eta; i++, q = qShift(q, 1)) {
      const r = qRange(q);
      let add = 0;
      if (Number(g.perQuincena) > 0 && (!g.from || g.from <= r.end) && (!g.until || g.until >= r.start)) add += Number(g.perQuincena);
      for (const d of s.debts) {
        if (d.mode === 'pagos' || !d.until) continue;
        const red = (d.redirects || []).find(x => x.goalId === g.id);
        const date = red && dateFor(d.day, r);
        if (date && date > d.until) add += Number(red.amount) || Number(d.amount) || 0;
      }
      for (const m of planned) if (m.date >= r.start && m.date <= r.end) add += m.amount;
      acc += add;
      if (acc >= target) eta = r.start;
    }
  }
  return { saved, target, pct: target ? Math.min(100, Math.round((saved / target) * 100)) : null, done: target > 0 && saved >= target, eta, nextPlanned: planned[0] || null };
}

// Total mensual de gastos fijos activos (en COP).
export function monthlyFixed(s) {
  return s.fixed.filter(f => f.active !== false).reduce((a, f) => a + toCop(f.amount, f.currency, s), 0);
}

// ---------- La quincena ----------

// Con cuánto arranca la quincena: lo que él puso, o lo que sobró de la anterior.
export function startOf(s, q, depth = 0) {
  const rec = s.quincenas[q];
  if (rec && rec.start != null) return { value: rec.start, set: true, carried: false };
  if (depth > 48) return { value: 0, set: false, carried: false };
  const prev = qShift(q, -1);
  const current = qOf(today());
  // Arrastra el sobrante si la anterior tiene datos, o si estamos proyectando hacia adelante.
  if (s.quincenas[prev] || prev >= current) {
    return { value: build(s, prev, depth + 1).totals.sobrante, set: false, carried: true };
  }
  return { value: 0, set: false, carried: false };
}

// Bolsillos: 'libre', 'budget:<id>' o 'goal:<id>'.
export function pocketName(s, p) {
  if (!p || p === 'libre') return 'Libre';
  const [type, id] = p.split(':');
  if (type === 'budget') return s.budgets.find(b => b.id === id)?.name || 'Presupuesto';
  if (type === 'goal') return (s.goals || []).find(g => g.id === id)?.name || 'Meta';
  return 'Libre';
}

export function build(s, q, depth = 0) {
  const r = qRange(q);
  const rec = s.quincenas[q] || {};
  const checks = rec.checks || {};
  const accName = id => s.accounts.find(a => a.id === id)?.name || '';

  const item = (key, date, concept, accountId, planned, src) => {
    const c = checks[key];
    return {
      key, date, concept, src,
      account: accName(accountId),
      planned,
      amount: c?.amount ?? planned,
      done: !!c?.done,
      separated: !c?.done && !!c?.separated, // plata ya separada, falta que cobren
    };
  };
  const movItem = m => ({
    key: `mov:${m.id}`, date: m.date, concept: m.concept, account: accName(m.accountId),
    planned: m.amount, amount: m.amount, done: !!m.done, separated: !m.done && !!m.separated, src: { type: 'movement', id: m.id },
    currency: m.currency, original: m.original,
  });
  const movs = s.movements.filter(m => m.date >= r.start && m.date <= r.end);

  // Bolsillos: plata que entra directo a un presupuesto o meta, o que pasas de uno a otro.
  const moved = { budget: {}, goal: {} };
  const addPocket = (p, v) => {
    if (!p || p === 'libre') return;
    const [type, id] = p.split(':');
    if (moved[type]) moved[type][id] = (moved[type][id] || 0) + v;
  };
  for (const m of movs) {
    if (m.kind === 'ingreso') addPocket(m.pocket, m.amount);
    if (m.kind === 'mover') { addPocket(m.from, -m.amount); addPocket(m.to, m.amount); }
  }
  const transfers = movs.filter(m => m.kind === 'mover').map(m => ({
    ...m, fromName: pocketName(s, m.from), toName: pocketName(s, m.to),
  }));

  // Ingresos
  const incomes = [];
  for (const inc of s.incomes) {
    for (const day of inc.days || []) {
      const date = dateFor(day, r);
      if (!date || !inWindow(date, inc.from, inc.until)) continue;
      incomes.push(item(`inc:${inc.id}:${date}`, date, inc.name, inc.accountId, Number(inc.amount) || 0, { type: 'income', id: inc.id }));
    }
  }
  movs.filter(m => m.kind === 'ingreso').forEach(m => {
    const it = movItem(m);
    if (m.pocket && m.pocket !== 'libre') it.pocket = pocketName(s, m.pocket);
    incomes.push(it);
  });

  // Pagos: fijos, deudas, cuotas de manejo y pagos sueltos de esta quincena
  const payments = [];
  for (const f of s.fixed) {
    if (f.active === false) continue;
    const date = dateFor(f.day, r);
    if (!date || !inWindow(date, f.from, f.until)) continue;
    const it = item(`fix:${f.id}:${date}`, date, f.name, f.accountId, toCop(f.amount, f.currency, s), { type: 'fixed', id: f.id });
    if (f.currency === 'USD') { it.currency = 'USD'; it.original = Number(f.amount); }
    payments.push(it);
  }
  for (const d of s.debts) {
    for (const p of debtSchedule(d)) {
      if (p.date < r.start || p.date > r.end) continue;
      const concept = p.period ? `${d.name} · ${p.period.label}` : d.name;
      payments.push(item(`debt:${d.id}:${p.date}`, p.date, concept, d.accountId, p.amount, { type: 'debt', id: d.id }));
    }
  }
  for (const a of s.accounts) {
    if (!a.fee || !a.feeDay) continue;
    const date = dateFor(a.feeDay, r);
    if (!date) continue;
    payments.push(item(`fee:${a.id}:${date}`, date, `Cuota de manejo ${a.name}`, a.id, Number(a.fee), { type: 'account', id: a.id }));
  }
  movs.filter(m => m.kind === 'pago').forEach(m => payments.push(movItem(m)));

  // Ahorro: aporte fijo por quincena a cada meta, lo que era una deuda que ya terminó, y aportes sueltos.
  const savings = [];
  for (const g of s.goals || []) {
    if (g.active === false) continue;
    const reached = g.target > 0 && goalSaved(s, g) >= g.target;
    const add = (key, date, concept, amount, extra = {}) => {
      const it = item(key, date, concept, g.accountId, amount, { type: 'goal', id: g.id, ...extra });
      if (!reached || it.done) savings.push(it);
    };
    if (Number(g.perQuincena) > 0 && (!g.from || g.from <= r.end) && (!g.until || g.until >= r.start)) {
      add(`goal:${g.id}:q:${r.start}`, r.start, `Ahorro: ${g.name}`, Number(g.perQuincena));
    }
    for (const d of s.debts) {
      if (d.mode === 'pagos' || !d.until) continue;
      for (const red of d.redirects || []) {
        if (red.goalId !== g.id) continue;
        const date = dateFor(d.day, r);
        if (!date || date <= d.until) continue;
        add(`goal:${g.id}:${d.id}:${date}`, date, `Ahorro: ${g.name} (lo que era ${d.name})`, Number(red.amount) || Number(d.amount) || 0, { debtId: d.id });
      }
    }
  }
  movs.filter(m => m.kind === 'ahorro').forEach(m => savings.push(movItem(m)));

  // Presupuestos (monto por quincena; se puede cambiar solo para esta)
  const overrides = rec.budgetOverrides || {};
  const gastos = movs.filter(m => m.kind === 'gasto');
  const budgets = s.budgets.filter(b => b.active !== false).map(b => {
    const own = overrides[b.id] ?? (Number(b.amount) || 0);
    const extra = moved.budget[b.id] || 0;
    const amount = Math.max(0, own + extra);
    const spent = gastos.filter(g => g.budgetId === b.id).reduce((a, g) => a + g.amount, 0);
    return { id: b.id, name: b.name, amount, own, moved: extra, base: Number(b.amount) || 0, spent, left: amount - spent };
  });
  const budgetIds = new Set(budgets.map(b => b.id));
  const loose = gastos.filter(g => !budgetIds.has(g.budgetId));

  const tasks = rec.tasks || [];
  const start = startOf(s, q, depth);

  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
  const ingresos = sum(incomes, x => x.amount);
  const pagos = sum(payments, x => x.amount);
  const presupuestos = sum(budgets, b => Math.max(b.amount, b.spent));
  const sueltos = sum(loose, g => g.amount);
  const alMetas = Object.values(moved.goal).reduce((a, v) => a + v, 0);
  const ahorro = sum(savings, x => x.amount) + alMetas;
  const sobrante = start.value + ingresos - pagos - presupuestos - sueltos - ahorro;

  // Apartados: montos fijos, o "todo lo que sobre" (se ajusta solo si algo cambia, como el dólar).
  const raw = rec.reserves || [];
  let left = sobrante - sum(raw.filter(x => !x.all), x => Number(x.amount) || 0);
  const reserves = raw.map(x => {
    if (!x.all) return x;
    const amount = Math.max(0, left);
    left -= amount;
    return { ...x, amount };
  });
  const apartado = sum(reserves, x => Number(x.amount) || 0);

  return {
    q, range: r, rec, start,
    incomes, payments, savings, budgets, gastos, loose, reserves, tasks, transfers, moved,
    totals: {
      alMetas,
      inicio: start.value, ingresos, pagos, presupuestos, sueltos, ahorro, apartado, sobrante,
      libre: sobrante - apartado,
      porPagar: sum(payments.filter(p => !p.done), p => p.amount),
      separado: sum(payments.filter(p => p.separated), p => p.amount),
      porRecibir: sum(incomes.filter(i => !i.done), i => i.amount),
    },
  };
}

// ---------- ¿Me lo puedo permitir? ----------
// Si es de un presupuesto, primero usa lo que queda de ese presupuesto.
// Lo que no quepa ahí sale de lo libre de la quincena.
export function afford(s, q, amountCop, budgetId) {
  const b = build(s, q);
  const t = b.totals;
  const min = Number(s.settings.minimo) || 0;
  const budget = budgetId ? b.budgets.find(x => x.id === budgetId) || null : null;
  const fromBudget = budget ? Math.min(amountCop, Math.max(0, budget.left)) : 0;
  const extra = amountCop - fromBudget;
  const libreAfter = t.libre - extra;

  let verdict;
  if (amountCop <= 0) verdict = null;
  else if (extra === 0) verdict = 'si';
  else if (libreAfter >= min) verdict = 'si';
  else if (libreAfter >= 0) verdict = 'justo';
  else verdict = 'no';

  let next = null;
  if (verdict === 'no' || verdict === 'justo') {
    const nq = qShift(q, 1);
    const nb = build(s, nq);
    next = { q: nq, start: nb.range.start, libre: nb.totals.libre, ok: nb.totals.libre - amountCop >= min };
  }
  return { verdict, amountCop, budget, fromBudget, extra, libreBefore: t.libre, libreAfter, min, next, totals: t };
}
