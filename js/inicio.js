// Pantalla de Inicio: cómo vas hoy, avisos, deudas, metas, próximas quincenas y resumen del mes.

import { fmt, fmtDate, esc, today, fromIso, iso, MESES_LARGO } from './money.js';
import { qOf, qShift, qTitle, build, debtStatus, goalStatus } from './quincena.js';

const h2 = (ico, text) => `<h2 class="with-ico"><span class="ico">${ico}</span>${text}</h2>`;

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const addDays = (d, n) => { const x = fromIso(d); x.setDate(x.getDate() + n); return iso(x); };
const daysBetween = (a, b) => Math.round((fromIso(b) - fromIso(a)) / 86400000);
const inDays = n => n === 0 ? 'hoy' : n === 1 ? 'mañana' : `en ${n} días`;

function longDate(d) {
  const x = fromIso(d);
  return `${DIAS[x.getDay()]} ${x.getDate()} de ${MESES_LARGO[x.getMonth()]}`;
}

// Avisos útiles: cobros que vienen, cosas atrasadas, quincenas que no cuadran.
export function alerts(s) {
  const t = today();
  const cur = qOf(t);
  const out = [];
  const now = build(s, cur);
  const next = build(s, qShift(cur, 1));
  const soon = addDays(t, 7);

  const late = now.payments.filter(p => !p.done && p.date < t);
  for (const p of late) out.push({ tone: 'neg', q: cur, text: `Se pasó la fecha de <b>${esc(p.concept)}</b> (${fmtDate(p.date)}, ${fmt(p.amount)}). ¿Ya lo pagaste?` });

  const upcoming = [...now.payments, ...next.payments].filter(p => !p.done && p.date >= t && p.date <= soon);
  const open = upcoming.filter(p => !p.separated);
  const ready = upcoming.filter(p => p.separated);
  const total = arr => fmt(arr.reduce((a, p) => a + p.amount, 0));
  if (open.length > 2) {
    out.push({ tone: 'warn', q: qOf(open[0].date), text: `Esta semana tienes <b>${open.length} pagos por ${total(open)}</b> sin plata separada. El primero es ${esc(open[0].concept)}, ${inDays(daysBetween(t, open[0].date))}.` });
  } else {
    for (const p of open) out.push({ tone: 'warn', q: qOf(p.date), text: `<b>${esc(p.concept)}</b> se cobra ${inDays(daysBetween(t, p.date))}: ${fmt(p.amount)}${p.account ? ` en ${esc(p.account)}` : ''}. ¿Ya separaste la plata?` });
  }
  if (ready.length) out.push({ tone: 'ok', q: qOf(ready[0].date), text: ready.length === 1
    ? `<b>${esc(ready[0].concept)}</b> se cobra ${inDays(daysBetween(t, ready[0].date))}. La plata ya está separada.`
    : `${ready.length} cobros de esta semana (${total(ready)}) ya tienen la plata separada.` });

  if (!now.start.set && !now.start.carried) out.push({ tone: 'warn', q: cur, text: 'Aún no pusiste con cuánto arrancas esta quincena. Sin eso, los números no son reales.' });

  for (const bud of now.budgets) {
    if (bud.amount > 0 && bud.spent > bud.amount) out.push({ tone: 'neg', q: cur, text: `Te pasaste ${fmt(bud.spent - bud.amount)} en <b>${esc(bud.name)}</b> esta quincena.` });
    else if (bud.amount > 0 && bud.spent / bud.amount >= 0.85) out.push({ tone: 'warn', q: cur, text: `Vas en ${Math.round((bud.spent / bud.amount) * 100)}% de <b>${esc(bud.name)}</b>: te quedan ${fmt(bud.left)}.` });
  }

  for (let i = 0; i < 6; i++) {
    const q = qShift(cur, i);
    const libre = (i === 0 ? now : i === 1 ? next : build(s, q)).totals.libre;
    if (libre < 0) out.push({ tone: 'neg', q, text: `En <b>${qTitle(q)}</b> te faltan ${fmt(-libre)} para cubrir todo. Mejor ajustarlo desde ya.` });
  }
  return out;
}

export function inicioView(ctx) {
  const { s } = ctx;
  const t = today();
  const cur = qOf(t);
  const now = build(s, cur);
  const next = build(s, qShift(cur, 1));

  // Próxima plata que entra
  const nextIncome = [...now.incomes, ...next.incomes].filter(i => !i.done && i.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0];

  // Próximos pagos (14 días)
  const horizon = addDays(t, 14);
  const upcoming = [...now.payments, ...next.payments]
    .filter(p => !p.done && p.date <= horizon)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6);

  const al = alerts(s);
  const hasData = s.incomes.length || s.fixed.length || s.debts.length || s.accounts.length;

  // Deudas
  const debts = s.debts.map(d => ({ d, st: debtStatus(s, d) })).filter(x => x.st.count);
  const debtTotal = debts.reduce((a, x) => a + x.st.total, 0);
  const debtPaid = debts.reduce((a, x) => a + x.st.paid, 0);
  const debtLeft = debts.reduce((a, x) => a + x.st.remaining, 0);
  const debtEnd = debts.filter(x => x.st.left).map(x => x.st.last).sort().pop();

  // Proyección de quincenas
  const proj = [];
  for (let i = 0, q = cur; i < 6; i++, q = qShift(q, 1)) proj.push({ q, t: (i === 0 ? now : i === 1 ? next : build(s, q)).totals });
  const maxAbs = Math.max(1, ...proj.map(p => Math.abs(p.t.libre)));

  // Resumen del mes (las dos quincenas del mes actual)
  const [y, m] = t.split('-');
  const q1 = build(s, `${y}-${m}-1`);
  const q2 = build(s, `${y}-${m}-2`);
  const both = [q1, q2];
  const sumBy = f => both.reduce((a, b) => a + f(b), 0);
  const byType = type => sumBy(b => b.payments.filter(p => p.src.type === type).reduce((a, p) => a + p.amount, 0));
  const month = {
    entra: sumBy(b => b.totals.ingresos),
    fijos: byType('fixed') + byType('account'),
    deudas: byType('debt'),
    otros: byType('movement'),
    presupuestos: sumBy(b => b.totals.presupuestos),
    sueltos: sumBy(b => b.totals.sueltos),
    ahorro: sumBy(b => b.totals.ahorro),
  };
  const sale = month.fijos + month.deudas + month.otros + month.presupuestos + month.sueltos + month.ahorro;
  const mesNombre = MESES_LARGO[Number(m) - 1];

  const bar = (pct, cls = '') => `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;
  const tone = { neg: 'neg', warn: 'warn', ok: 'ok' };

  return `
  <header class="page-head home-head">
    <p class="sub cap">${longDate(t)}</p>
    <h1>${s.settings.name ? `Hola, ${esc(s.settings.name)}` : 'Hola'}</h1>
  </header>

  ${!hasData ? `<section class="card"><h2>Empecemos</h2>
    <p class="muted">Agrega tus cuentas en <a href="#cuentas">Cuentas</a> y tu pago, gastos fijos y deudas en <a href="#plan">Plan</a>. La app arma cada quincena sola.</p></section>` : ''}

  <a class="hero hero-link-card ${now.totals.libre < 0 ? 'neg' : ''}" href="#quincena" data-act="go-q" data-q="${cur}">
    <p class="label">Libre esta quincena</p>
    <p class="big">${fmt(now.totals.libre)}</p>
    <p class="sub">${nextIncome
      ? `Próxima plata: <b>${esc(nextIncome.concept)} ${fmt(nextIncome.amount)}</b> ${inDays(daysBetween(t, nextIncome.date))} (${fmtDate(nextIncome.date)})`
      : 'Ver la quincena →'}</p>
  </a>

  <section class="card">
    ${h2('🔔', 'Atento')}
    ${al.length ? `<ul class="alerts">${al.map(a => `
      <li class="alert ${tone[a.tone]}"><button class="line" data-act="go-q" data-q="${a.q}"><span>${a.text}</span></button></li>`).join('')}</ul>`
      : `<p class="muted">Todo en orden por ahora.</p>`}
  </section>

  ${upcoming.length ? `<section class="card">${h2('📅', 'Próximos pagos')}
    <ul class="plain">${upcoming.map(p => `
      <li><button class="line row-btn" data-act="go-q" data-q="${qOf(p.date)}">
        <span><b>${fmtDate(p.date)}</b> – ${esc(p.concept)}${p.separated ? ' <span class="tag sep">separado</span>' : ''}</span>
        <span>${fmt(p.amount)}</span></button></li>`).join('')}</ul></section>` : ''}

  ${debts.length ? `<section class="card">${h2('💳', 'Deudas')}
    ${debtLeft > 0 ? `
      <div class="row"><span>Te falta pagar</span><span><b>${fmt(debtLeft)}</b></span></div>
      ${bar(debtTotal ? (debtPaid / debtTotal) * 100 : 0)}
      <p class="muted small">Llevas ${fmt(debtPaid)} de ${fmt(debtTotal)}. Si cumples, quedas <b>sin deudas el ${fmtDate(debtEnd, true)}</b>.</p>
      <ul class="plain mini">${debts.filter(x => x.st.left).map(x => `
        <li><a class="line row-btn" href="#plan"><span>${esc(x.d.name)} <span class="muted">· ${x.st.left === 1 ? 'último pago' : `${x.st.left} pagos`} · ${fmtDate(x.st.last)}</span></span><span>${fmt(x.st.remaining)}</span></a></li>`).join('')}</ul>`
      : `<p class="goal">No tienes deudas pendientes.</p>`}
  </section>` : ''}

  <section class="card">${h2('🎯', 'Metas')}
    ${(s.goals || []).length ? `<ul class="plain">${s.goals.filter(g => g.active !== false).map(g => {
      const st = goalStatus(s, g);
      const redirect = s.debts.find(d => (d.redirects || []).some(r => r.goalId === g.id) && d.until && d.until >= t);
      return `<li><a class="line goal-row" href="#plan">
        <div class="row"><span><b>${esc(g.name)}</b></span><span>${fmt(st.saved)}${st.target ? ` <span class="muted">de ${fmt(st.target)}</span>` : ''}</span></div>
        ${st.target ? bar(st.pct, st.done ? '' : 'goal-bar') : ''}
        <div class="muted small">${st.done ? '¡Meta cumplida!'
          : st.eta ? `A este ritmo la cumples en ${MESES_LARGO[Number(st.eta.split('-')[1]) - 1]} ${st.eta.split('-')[0]}.`
          : redirect ? `Desde que termines ${esc(redirect.name)} (${fmtDate(redirect.until, true)}), esa cuota se va a esta meta.`
          : st.nextPlanned ? `Tienes un aporte de ${fmt(st.nextPlanned.amount)} planeado el ${fmtDate(st.nextPlanned.date)}.`
          : g.perQuincena ? `Aportas ${fmt(g.perQuincena)} cada quincena.` : 'Sin aporte fijo todavía.'}</div>
      </a></li>`;
    }).join('')}</ul>` : `<p class="muted">Crea tus metas en <a href="#plan">Plan</a>: colchón, paseo, equipo nuevo…</p>`}
  </section>

  <section class="card">${h2('📈', 'Próximas quincenas')}
    <ul class="plain proj">${proj.map(p => `
      <li><button class="line" data-act="go-q" data-q="${p.q}">
        <div class="row"><span>${qTitle(p.q)}</span><span class="${p.t.libre < 0 ? 'neg' : ''}"><b>${fmt(p.t.libre)}</b> <span class="muted">libre</span></span></div>
        <div class="proj-bar ${p.t.libre < 0 ? 'neg' : ''}"><i style="width:${Math.round((Math.abs(p.t.libre) / maxAbs) * 100)}%"></i></div>
      </button></li>`).join('')}</ul>
    <p class="muted small">Contando lo que sobra de cada quincena, lo que tienes apartado y lo que va a ahorro.</p>
  </section>

  <section class="card">${h2('📊', `${mesNombre[0].toUpperCase() + mesNombre.slice(1)} en números`)}
    <div class="ledger">
      <div class="row"><span>Entra</span><span>${fmt(month.entra)}</span></div>
      ${month.fijos ? `<div class="row"><span>Gastos fijos</span><span>${fmt(month.fijos)}</span></div>` : ''}
      ${month.deudas ? `<div class="row"><span>Deudas</span><span>${fmt(month.deudas)}</span></div>` : ''}
      ${month.otros ? `<div class="row"><span>Pagos de una vez</span><span>${fmt(month.otros)}</span></div>` : ''}
      ${month.presupuestos ? `<div class="row"><span>Presupuestos</span><span>${fmt(month.presupuestos)}</span></div>` : ''}
      ${month.sueltos ? `<div class="row"><span>Gastos sin presupuesto</span><span>${fmt(month.sueltos)}</span></div>` : ''}
      ${month.ahorro ? `<div class="row"><span>Ahorro</span><span>${fmt(month.ahorro)}</span></div>` : ''}
      <div class="row total"><span>Sale</span><span><b>${fmt(sale)}</b></span></div>
    </div>
    ${month.entra ? stackBar([
      ['fijos', month.fijos], ['deudas', month.deudas], ['otros', month.otros], ['presupuestos', month.presupuestos + month.sueltos], ['ahorro', month.ahorro],
    ], Math.max(month.entra, sale)) : ''}
  </section>`;
}

function stackBar(parts, total) {
  const labels = { fijos: 'Fijos', deudas: 'Deudas', otros: 'De una vez', presupuestos: 'Presupuestos', ahorro: 'Ahorro' };
  const shown = parts.filter(([, v]) => v > 0);
  return `<div class="stack" role="img" aria-label="En qué se va la plata del mes">${shown.map(([k, v]) =>
    `<i class="s-${k}" style="width:${(v / total) * 100}%"></i>`).join('')}</div>
    <ul class="stack-legend">${shown.map(([k, v]) => `<li><i class="s-${k}"></i>${labels[k]} ${Math.round((v / total) * 100)}%</li>`).join('')}</ul>`;
}
