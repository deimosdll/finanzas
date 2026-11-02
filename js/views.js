// Las 4 pantallas (Quincena, ¿Me alcanza?, Plan, Cuentas) y lo que pasa al tocar cada cosa.

import { fmt, fmtUsd, fmtDate, esc, today, iso, parseMoney, fmtPlain } from './money.js';
import { qOf, qShift, qTitle, qSubtitle, build, afford, debtStatus, monthlyFixed, ensureRec, toCop, goalStatus } from './quincena.js';
import { inicioView } from './inicio.js';
import { nubeSection, atajosSection, nubeActions } from './nube.js';
import { openForm, toast } from './forms.js';
import { uid, exportJson, parseImport, emptyState } from './store.js';

// ---------- Piezas comunes ----------

const ACCOUNT_TYPES = [
  { value: 'ahorros', label: 'Cuenta de ahorros' },
  { value: 'credito', label: 'Tarjeta de crédito' },
  { value: 'billetera', label: 'Billetera digital' },
  { value: 'otra', label: 'Otra' },
];
const typeLabel = v => ACCOUNT_TYPES.find(t => t.value === v)?.label || 'Cuenta';

const accountOptions = (s, emptyLabel = 'Sin cuenta') =>
  [{ value: '', label: emptyLabel }, ...s.accounts.map(a => ({ value: a.id, label: a.name }))];
const budgetOptions = s =>
  [{ value: '', label: 'Ninguno (gasto suelto)' }, ...s.budgets.filter(b => b.active !== false).map(b => ({ value: b.id, label: b.name }))];
const currencyOptions = [{ value: 'COP', label: 'Pesos (COP)' }, { value: 'USD', label: 'Dólares (USD)' }];

// "**3 nov** – Spotify (Billetera): $30.500"
function lineText(it) {
  const usd = it.currency === 'USD' && it.original ? ` <span class="muted">(${fmtUsd(it.original)})</span>` : '';
  const changed = it.planned != null && it.amount !== it.planned ? ` <span class="muted">· plan ${fmt(it.planned)}</span>` : '';
  return `<b>${fmtDate(it.date)}</b> – ${esc(it.concept)}${it.account ? ` (${esc(it.account)})` : ''}: ${fmt(it.amount)}${usd}${changed}`;
}

function checklist(items, act, emptyText) {
  if (!items.length) return `<p class="empty">${emptyText}</p>`;
  const sorted = [...items].sort((a, b) => (a.done - b.done) || a.date.localeCompare(b.date) || a.concept.localeCompare(b.concept));
  return `<ul class="checklist">${sorted.map(it => `
    <li class="${it.done ? 'done' : ''}">
      <button class="check" data-act="${act}-toggle" data-key="${esc(it.key)}" role="checkbox" aria-checked="${it.done ? 'true' : it.separated ? 'mixed' : 'false'}"
        aria-label="${esc(it.concept)}: ${it.done ? (act === 'inc' ? 'llegó' : 'pagado') : it.separated ? 'plata separada' : 'pendiente'}"></button>
      <button class="line" data-act="${act}-edit" data-key="${esc(it.key)}">${lineText(it)}${it.separated ? ' <span class="tag sep">separado</span>' : ''}</button>
    </li>`).join('')}</ul>`;
}

// "💵 Ingresos" -> ícono en su recuadro + título
function heading(title) {
  const m = title.match(/^(\S+)\s+(.*)$/);
  return m && !/^[\p{L}\p{N}¿]/u.test(m[1]) ? `<h2 class="with-ico"><span class="ico">${m[1]}</span>${m[2]}</h2>` : `<h2>${title}</h2>`;
}
export const section = (title, body, extra = '') => `<section class="card">${heading(title)}${body}${extra}</section>`;
const addBtn = (act, label, data = '') => `<button class="add" data-act="${act}" ${data}>${label}</button>`;
const row = (label, value, cls = '') => `<div class="row ${cls}"><span>${label}</span><span>${value}</span></div>`;

// ================================================================
// 1. QUINCENA
// ================================================================

function quincenaView(ctx) {
  const { s } = ctx;
  const q = ctx.ui.q;
  const b = build(s, q);
  ctx.cur = b;
  const t = b.totals;
  const isNow = q === qOf(today());
  const rec = b.rec;

  const startBanner = b.start.set ? '' : `
    <button class="banner" data-act="q-start">
      ${b.start.carried
        ? `Arrancas con <b>${fmt(b.start.value)}</b>, lo que sobró de la quincena anterior. Toca si en realidad tienes otra cifra.`
        : `<b>¿Con cuánto arrancas esta quincena?</b> Toca para poner la plata que tienes hoy, antes del pago.`}
    </button>`;

  const budgets = b.budgets.length ? `<ul class="budgets">${b.budgets.map(x => {
    const pct = x.amount > 0 ? Math.min(100, Math.round((x.spent / x.amount) * 100)) : (x.spent > 0 ? 100 : 0);
    const over = x.spent > x.amount;
    return `<li><button class="budget" data-act="budget-open" data-id="${x.id}">
      <div class="budget-top"><span class="name">${esc(x.name)}</span>
        <span class="${over ? 'neg' : ''}">${fmt(x.spent)} <span class="muted">de ${fmt(x.amount)}</span></span></div>
      <div class="bar ${over ? 'over' : pct >= 85 ? 'warn' : ''}"><i style="width:${pct}%"></i></div>
      <div class="budget-foot muted">${over ? `Te pasaste ${fmt(x.spent - x.amount)}` : `Te quedan ${fmt(x.left)}`}${x.amount !== x.base ? ' · cambiado solo esta quincena' : ''}</div>
    </button></li>`;
  }).join('')}</ul>` : `<p class="empty">Aún no tienes presupuestos. Créalos en <a href="#plan">Plan</a> (por ejemplo Mercado o Salidas).</p>`;

  const gastos = b.gastos.length ? `<ul class="plain">${[...b.gastos].sort((a, c) => c.date.localeCompare(a.date)).map(g => {
    const bud = s.budgets.find(x => x.id === g.budgetId);
    const acc = s.accounts.find(a => a.id === g.accountId);
    return `<li><button class="line" data-act="mov-edit" data-id="${g.id}">
      <b>${fmtDate(g.date)}</b> – ${esc(g.concept)}${acc ? ` (${esc(acc.name)})` : ''}: ${fmt(g.amount)}
      ${g.currency === 'USD' ? `<span class="muted">(${fmtUsd(g.original)})</span>` : ''}
      <span class="tag">${bud ? esc(bud.name) : 'Sin presupuesto'}</span></button></li>`;
  }).join('')}</ul>` : `<p class="empty">Nada anotado todavía.</p>`;

  const tasks = b.tasks.length ? `<ul class="checklist">${[...b.tasks].sort((a, c) => a.done - c.done).map(x => `
    <li class="${x.done ? 'done' : ''}">
      <button class="check" data-act="task-toggle" data-id="${x.id}" role="checkbox" aria-checked="${!!x.done}" aria-label="Marcar pendiente"></button>
      <button class="line" data-act="task-edit" data-id="${x.id}">${esc(x.text)}</button>
    </li>`).join('')}</ul>` : '';

  const reserves = b.reserves.length ? `<ul class="plain sub-list">${b.reserves.map(x => `
    <li><button class="line" data-act="reserve-edit" data-id="${x.id}">${esc(x.concept)}: ${fmt(x.amount)}${x.all ? ' <span class="muted">(todo lo que sobra)</span>' : ''}</button></li>`).join('')}</ul>` : '';

  const accounts = s.accounts.length ? `
    <h3>Saldo por cuenta</h3>
    <ul class="plain">${s.accounts.map(a => `
      <li><button class="line row-btn" data-act="balance-edit" data-id="${a.id}">
        <span>${esc(a.name)} <span class="muted">· ${typeLabel(a.type)}</span></span>
        <span class="${a.type === 'credito' ? 'muted' : ''}">${a.type === 'credito' ? 'debes ' : ''}${fmt(a.balance || 0)}</span>
      </button></li>`).join('')}</ul>` : '';

  return `
  <header class="qhead">
    <button class="icon-btn" data-act="q-prev" aria-label="Quincena anterior">‹</button>
    <div class="qtitle">
      <h1>💰 ${qTitle(q)}</h1>
      <p class="sub">${qSubtitle(q)}${rec.reviewedAt ? ` · Revisión: ${fmtDate(rec.reviewedAt)}` : ''}</p>
    </div>
    <button class="icon-btn" data-act="q-next" aria-label="Quincena siguiente">›</button>
  </header>
  ${isNow ? '' : `<button class="link center" data-act="q-today">Volver a la quincena actual</button>`}

  <section class="hero ${t.libre < 0 ? 'neg' : ''}">
    <p class="label">Libre para gastar</p>
    <p class="big">${fmt(t.libre)}</p>
    <p class="sub">${t.libre < 0
      ? 'No te alcanza para todo lo de esta quincena. Revisa presupuestos o pagos.'
      : 'Ya descontados los pagos, los presupuestos y lo apartado.'}</p>
    <a class="hero-link" href="#alcanza">¿Me lo puedo permitir? →</a>
  </section>
  ${startBanner}

  ${section('💵 Ingresos', checklist(b.incomes, 'inc', 'No hay ingresos en esta quincena. Agrega tu pago fijo en <a href="#plan">Plan</a>.'),
    addBtn('mov-add', '+ Ingreso extra', 'data-kind="ingreso"'))}

  ${section('📅 Calendario de pagos', checklist(b.payments, 'pay', 'No hay pagos en esta quincena.') +
    (b.payments.length ? `<p class="legend">Un toque: plata separada · dos: pagado · tres: vacío</p>` : ''),
    addBtn('mov-add', '+ Pago solo de esta quincena', 'data-kind="pago"'))}

  ${(b.savings.length || (ctx.s.goals || []).length) ? section('🎯 Ahorro', checklist(b.savings, 'sav', 'Esta quincena no hay aportes a metas.'),
    (ctx.s.goals || []).length ? addBtn('mov-add', '+ Aportar a una meta', 'data-kind="ahorro"') : '') : ''}

  ${section('📊 Presupuestos', budgets)}

  ${section('🧾 Gastos', gastos, addBtn('mov-add', '+ Anotar gasto', 'data-kind="gasto"'))}

  ${section('📝 Pendientes', tasks, `
    <form class="inline-add" data-form="task">
      <input name="text" placeholder="Nuevo pendiente" autocomplete="off" aria-label="Nuevo pendiente">
      <button class="btn small" type="submit">Agregar</button>
    </form>`)}

  ${section('🏦 Mi plata', `
    <div class="ledger">
      ${row('Arrancas con', `<button class="link" data-act="q-start">${fmt(t.inicio)}</button>`)}
      ${row('+ Entra', fmt(t.ingresos))}
      ${row('− Pagos', fmt(t.pagos))}
      ${row('− Presupuestos', fmt(t.presupuestos))}
      ${t.ahorro ? row('− Ahorro a metas', fmt(t.ahorro)) : ''}
      ${t.sueltos ? row('− Gastos sin presupuesto', fmt(t.sueltos)) : ''}
      ${row('Sobra', `<b>${fmt(t.sobrante)}</b>`, 'total' + (t.sobrante < 0 ? ' neg' : ''))}
      ${row('− Apartado', fmt(t.apartado))}
      ${reserves}
      ${row('Libre', `<b>${fmt(t.libre)}</b>`, 'total' + (t.libre < 0 ? ' neg' : ''))}
    </div>
    ${addBtn('reserve-add', '+ Apartar plata (ya tiene destino)')}
    ${t.porPagar || t.porRecibir ? `<p class="muted small">Falta por pagar ${fmt(t.porPagar)}${t.separado ? ` (ya separaste ${fmt(t.separado)})` : ''} · falta por recibir ${fmt(t.porRecibir)}</p>` : ''}
    ${accounts}`)}

  <button class="btn ghost wide" data-act="q-review">Marcar revisión de hoy</button>
  <button class="fab" data-act="mov-add" data-kind="gasto" aria-label="Anotar gasto">+ Gasto</button>`;
}

// ================================================================
// 2. ¿ME ALCANZA?
// ================================================================

function alcanzaView(ctx) {
  const { s } = ctx;
  const af = ctx.ui.af;
  return `
  <header class="page-head"><h1>¿Me lo puedo permitir?</h1>
    <p class="sub">Escribe cuánto cuesta y te digo si te alcanza sin descuadrar la quincena.</p></header>
  <section class="card">
    <label class="field big-field"><span>¿Cuánto cuesta?</span>
      <div class="amount-row">
        <input id="af-amount" inputmode="${af.currency === 'USD' ? 'decimal' : 'numeric'}" ${af.currency === 'COP' ? 'data-money="COP"' : ''}
          autocomplete="off" placeholder="0" value="${esc(af.text)}" aria-label="Monto">
        <div class="seg" role="group" aria-label="Moneda">
          <button data-act="af-cur" data-cur="COP" aria-pressed="${af.currency === 'COP'}">COP</button>
          <button data-act="af-cur" data-cur="USD" aria-pressed="${af.currency === 'USD'}">USD</button>
        </div>
      </div>
    </label>
    <label class="field"><span>¿De qué es?</span>
      <select id="af-budget">
        <option value="">Otra cosa (no está en un presupuesto)</option>
        ${s.budgets.filter(b => b.active !== false).map(b => `<option value="${b.id}" ${af.budgetId === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
      </select></label>
    <div class="field"><span>¿Cuándo?</span>
      <div class="seg wide" role="group" aria-label="Cuándo">
        <button data-act="af-when" data-when="now" aria-pressed="${af.when === 'now'}">Esta quincena</button>
        <button data-act="af-when" data-when="next" aria-pressed="${af.when === 'next'}">La próxima</button>
      </div></div>
  </section>
  <div id="af-result">${alcanzaResult(ctx)}</div>`;
}

export function alcanzaResult(ctx) {
  const { s } = ctx;
  const af = ctx.ui.af;
  const amount = parseMoney(af.text, af.currency);
  const cop = toCop(amount, af.currency, s);
  const q = af.when === 'next' ? qShift(qOf(today()), 1) : qOf(today());
  if (!cop) {
    const t = build(s, q).totals;
    return `<section class="card muted-card"><p>Para ${af.when === 'next' ? 'la próxima quincena' : 'esta quincena'} tienes <b>${fmt(t.libre)}</b> libres.</p></section>`;
  }
  const r = afford(s, q, cop, af.budgetId || null);
  const titles = { si: 'Sí, te alcanza', justo: 'Te alcanza, pero queda justo', no: 'No te alcanza' };
  const lines = [];
  if (af.currency === 'USD') lines.push(`${fmtUsd(amount)} son unos <b>${fmt(cop)}</b> con el dólar a ${fmt(s.settings.usdRate)}.`);
  if (r.budget) {
    if (r.fromBudget >= cop) lines.push(`Entra completo en tu presupuesto de <b>${esc(r.budget.name)}</b>: te quedarían ${fmt(r.budget.left - cop)} ahí.`);
    else if (r.fromBudget > 0) lines.push(`De tu presupuesto de ${esc(r.budget.name)} quedan ${fmt(r.fromBudget)}. Los otros <b>${fmt(r.extra)}</b> saldrían de lo libre.`);
    else lines.push(`Tu presupuesto de ${esc(r.budget.name)} ya está agotado, así que todo saldría de lo libre.`);
  }
  if (r.extra > 0) {
    lines.push(`Tienes ${fmt(r.libreBefore)} libres. Después de esto te quedarían <b>${fmt(r.libreAfter)}</b>.`);
    if (r.verdict === 'justo') lines.push(`Eso es menos que tu colchón mínimo de ${fmt(r.min)}. Cualquier imprevisto te descuadra.`);
    if (r.verdict === 'no') lines.push(`Te faltarían <b>${fmt(-r.libreAfter)}</b> para cubrir todo lo de la quincena.`);
  }
  if (r.next) {
    const after = r.next.libre - cop;
    const when = `Si esperas a la próxima quincena (desde el ${fmtDate(r.next.start)})`;
    if (r.next.ok) lines.push(`${when}, sí te alcanzaría tranquilo: te quedarían ${fmt(after)} libres.`);
    else if (r.verdict === 'no' && after >= 0) lines.push(`${when}, te alcanzaría pero justo: te quedarían ${fmt(after)} libres.`);
    else if (r.verdict === 'no') lines.push(`Esperar a la próxima quincena tampoco basta: ahí tendrías ${fmt(r.next.libre)} libres.`);
  }
  return `
  <section class="verdict ${r.verdict}">
    <p class="verdict-title">${titles[r.verdict]}</p>
    ${lines.map(l => `<p>${l}</p>`).join('')}
  </section>
  ${r.verdict !== 'no' ? `<button class="btn primary wide" data-act="af-record">Lo compré: anotar como gasto</button>` : ''}`;
}

// ================================================================
// 3. PLAN (lo que se repite)
// ================================================================

function planView(ctx) {
  const { s } = ctx;
  const goals = (s.goals || []).length ? `<ul class="plain">${s.goals.map(g => {
    const st = goalStatus(s, g);
    const from = s.debts.filter(d => (d.redirects || []).some(r => r.goalId === g.id)).map(d => d.name);
    return `<li class="${g.active === false ? 'off' : ''}"><button class="line debt" data-act="goal-edit" data-id="${g.id}">
      <div class="row"><span><b>${esc(g.name)}</b></span><span>${fmt(st.saved)}${st.target ? ` <span class="muted">de ${fmt(st.target)}</span>` : ''}</span></div>
      <div class="muted small">${[g.perQuincena ? `${fmt(g.perQuincena)} por quincena` : '', from.length ? `recibe lo de ${from.map(esc).join(' y ')} cuando termine` : '', g.active === false ? 'pausada' : ''].filter(Boolean).join(' · ') || 'Sin aporte fijo'}</div>
    </button></li>`;
  }).join('')}</ul>` : `<p class="empty">Colchón de emergencia, paseo, equipo nuevo… Pon cuánto quieres juntar y cuánto aportas.</p>`;
  const accName = id => s.accounts.find(a => a.id === id)?.name;

  const incomes = s.incomes.length ? `<ul class="plain">${s.incomes.map(i => `
    <li><button class="line row-btn" data-act="income-edit" data-id="${i.id}">
      <span>${esc(i.name)} <span class="muted">· días ${(i.days || []).join(' y ')}${accName(i.accountId) ? ` · ${esc(accName(i.accountId))}` : ''}</span></span>
      <span>${fmt(i.amount)}</span></button></li>`).join('')}</ul>` : `<p class="empty">Agrega tu pago fijo (por ejemplo, el de los días 1 y 16).</p>`;

  const fixed = [...s.fixed].sort((a, b) => a.day - b.day);
  const fixedHtml = fixed.length ? `<ul class="plain">${fixed.map(f => `
    <li class="${f.active === false ? 'off' : ''}"><button class="line row-btn" data-act="fixed-edit" data-id="${f.id}">
      <span><b>Día ${f.day}</b> – ${esc(f.name)} <span class="muted">${accName(f.accountId) ? `· ${esc(accName(f.accountId))}` : ''}${f.until ? ` · hasta ${fmtDate(f.until, true)}` : ''}${f.active === false ? ' · pausado' : ''}</span></span>
      <span>${f.currency === 'USD' ? `${fmtUsd(f.amount)} <span class="muted">≈ ${fmt(toCop(f.amount, 'USD', s))}</span>` : fmt(f.amount)}</span>
    </button></li>`).join('')}</ul>
    ${row('Total al mes', `<b>${fmt(monthlyFixed(s))}</b>`, 'total')}` : `<p class="empty">Arriendo, servicios, suscripciones… lo que se paga igual cada mes.</p>`;

  let lastDebt = null;
  const debts = s.debts.length ? `<ul class="plain">${s.debts.map(d => {
    const st = debtStatus(s, d);
    if (st.left && (!lastDebt || st.last > lastDebt)) lastDebt = st.last;
    return `<li><button class="line debt" data-act="debt-edit" data-id="${d.id}">
      <div class="row"><span><b>${esc(d.name)}</b>${accName(d.accountId) ? ` <span class="muted">· ${esc(accName(d.accountId))}</span>` : ''}</span><span>${st.left ? fmt(st.remaining) : 'Pagada'}</span></div>
      <div class="muted small">${st.left
        ? `${st.left === 1 ? 'Falta 1 pago' : `Faltan ${st.left} pagos`} · próximo ${fmtDate(st.next.date)} por ${fmt(st.next.amount)} · último ${fmtDate(st.last, true)}`
        : 'Sin pagos pendientes'}</div>
    </button></li>`;
  }).join('')}</ul>
    ${lastDebt ? `<p class="goal">Si cumples los pagos, quedas <b>sin deudas el ${fmtDate(lastDebt, true)}</b>.</p>` : `<p class="goal">No tienes pagos de deudas pendientes.</p>`}`
    : `<p class="empty">Tarjeta de crédito, celular a cuotas, préstamos…</p>`;

  const budgets = s.budgets.length ? `<ul class="plain">${s.budgets.map(b => `
    <li class="${b.active === false ? 'off' : ''}"><button class="line row-btn" data-act="budget-edit" data-id="${b.id}">
      <span>${esc(b.name)}${b.active === false ? ' <span class="muted">· pausado</span>' : ''}</span><span>${fmt(b.amount)} <span class="muted">/ quincena</span></span>
    </button></li>`).join('')}</ul>` : `<p class="empty">Lo que te permites gastar por quincena en cosas que varían: mercado, salidas, corte…</p>`;

  return `
  <header class="page-head"><h1>Plan</h1><p class="sub">Lo que se repite. La app lo pone solo en cada quincena.</p></header>
  ${section('💵 Ingresos fijos', incomes, addBtn('income-add', '+ Ingreso fijo'))}
  ${section('🔁 Gastos fijos', fixedHtml, addBtn('fixed-add', '+ Gasto fijo'))}
  ${section('💳 Deudas', debts, addBtn('debt-add', '+ Deuda'))}
  ${section('📊 Presupuestos por quincena', budgets, addBtn('budget-add', '+ Presupuesto'))}
  ${section('🎯 Metas de ahorro', goals, addBtn('goal-add', '+ Meta'))}`;
}

// ================================================================
// 4. CUENTAS Y AJUSTES
// ================================================================

function cuentasView(ctx) {
  const { s } = ctx;
  const own = s.accounts.filter(a => a.type !== 'credito').reduce((a, x) => a + (Number(x.balance) || 0), 0);
  const owed = s.accounts.filter(a => a.type === 'credito').reduce((a, x) => a + (Number(x.balance) || 0), 0);

  const list = s.accounts.length ? `<ul class="plain">${s.accounts.map(a => `
    <li><button class="line account" data-act="account-edit" data-id="${a.id}">
      <div class="row"><span><b>${esc(a.name)}</b> <span class="muted">· ${typeLabel(a.type)}</span></span>
        <span>${a.type === 'credito' ? 'debes ' : ''}${fmt(a.balance || 0)}</span></div>
      ${a.role || a.fee ? `<div class="muted small">${esc(a.role || '')}${a.role && a.fee ? ' · ' : ''}${a.fee ? `cuota de manejo ${fmt(a.fee)}${a.feeDay ? ` el día ${a.feeDay}` : ''}` : ''}</div>` : ''}
    </button></li>`).join('')}</ul>
    ${row('Tienes en total', `<b>${fmt(own)}</b>`, 'total')}
    ${owed ? row('Debes en tarjetas', fmt(owed)) : ''}` : `<p class="empty">Agrega tus cuentas: dónde te llega la plata, dónde ahorras, con qué pagas suscripciones.</p>`;

  return `
  <header class="page-head"><h1>Cuentas</h1><p class="sub">Cada cuenta con un solo trabajo.</p></header>
  ${section('🏦 Mis cuentas', list, addBtn('account-add', '+ Cuenta'))}
  ${section('⚙️ Ajustes', `
    <ul class="plain">
      <li><button class="line row-btn" data-act="settings-edit">
        <span>Precio del dólar <span class="muted small">· ${usdNote(s)}</span></span><span>${fmt(s.settings.usdRate)}</span></button></li>
      <li><button class="line row-btn" data-act="settings-edit"><span>Colchón mínimo por quincena</span><span>${fmt(s.settings.minimo)}</span></button></li>
    </ul>
    ${s.settings.usdAuto !== false ? addBtn('usd-refresh', 'Actualizar el dólar ahora') : ''}
    <p class="muted small">El colchón mínimo es lo que siempre quieres que te quede libre. Si un gasto te deja por debajo, la app te dice "queda justo".</p>`)}
  ${section('☁️ Nube', nubeSection())}
  ${atajosSection() ? section('⚡ Atajos de Apple', atajosSection()) : ''}
  ${section('💾 Respaldo', `
    <p class="muted small">Tus datos están guardados en este dispositivo. Descarga un respaldo de vez en cuando.</p>
    <div class="btn-row">
      <button class="btn" data-act="export">Descargar respaldo</button>
      <label class="btn">Cargar respaldo<input type="file" accept="application/json,.json" data-act-change="import" hidden></label>
    </div>
    <button class="btn danger-ghost wide" data-act="wipe">Borrar todos los datos</button>`)}
  <p class="muted small center">Esto es una herramienta para organizarte, no asesoría financiera.</p>`;
}

// "cambio real, actualizado hoy 7:02 pm" o "fijo, lo pusiste tú"
function usdNote(s) {
  if (s.settings.usdAuto === false) return 'fijo, lo pusiste tú';
  const t = s.settings.usdUpdatedAt;
  if (!t) return 'cambio real, aún sin actualizar';
  const d = new Date(t);
  const hora = d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
  const dia = iso(d) === today() ? 'hoy' : fmtDate(iso(d));
  return `cambio real, actualizado ${dia} ${hora}`;
}

export const views = { inicio: inicioView, quincena: quincenaView, alcanza: alcanzaView, plan: planView, cuentas: cuentasView };

// ================================================================
// FORMULARIOS DE CADA COSA
// ================================================================

function accountForm(ctx, a) {
  const isNew = !a;
  a ??= { type: 'ahorros' };
  openForm({
    title: isNew ? 'Nueva cuenta' : a.name,
    fields: [
      { name: 'name', label: 'Nombre', value: a.name, placeholder: 'Mi banco', required: true },
      { name: 'type', label: 'Tipo', type: 'select', value: a.type, options: ACCOUNT_TYPES },
      { name: 'role', label: 'Para qué la usas', value: a.role, placeholder: 'Recibe el pago y paga el día a día' },
      { name: 'balance', label: 'Saldo hoy (en tarjeta: lo que debes)', type: 'money', value: a.balance },
      { name: 'fee', label: 'Cuota de manejo al mes', type: 'money', value: a.fee, hint: 'Déjala en 0 si no te cobran.' },
      { name: 'feeDay', label: 'Día en que la cobran', type: 'number', value: a.feeDay, min: 1, max: 31, placeholder: 'Opcional' },
      { name: 'ref', label: 'Número de cuenta o celular (opcional)', value: a.ref, placeholder: '3001234567', hint: 'Sirve para que los SMS del banco reconozcan cuándo pasas plata a esta cuenta y no lo cuenten como gasto.' },
    ],
    onSubmit: v => ctx.commit(s => {
      if (isNew) s.accounts.push({ id: uid(), ...v });
      else Object.assign(s.accounts.find(x => x.id === a.id), v);
    }),
    onDelete: isNew ? null : () => ctx.commit(s => { s.accounts = s.accounts.filter(x => x.id !== a.id); }),
  });
}

function incomeForm(ctx, i) {
  const isNew = !i;
  i ??= { days: [1, 16] };
  openForm({
    title: isNew ? 'Nuevo ingreso fijo' : i.name,
    intro: 'Solo plata personal. Plata compartida o reservas de otros no van aquí.',
    fields: [
      { name: 'name', label: 'De dónde viene', value: i.name, placeholder: 'Mi trabajo', required: true },
      { name: 'amount', label: 'Monto de cada pago', type: 'money', value: i.amount, required: true },
      { name: 'days', label: 'Días del mes en que llega', value: (i.days || []).join(', '), placeholder: '1, 16', hint: 'Separados por coma. Ejemplo: 1, 16', required: true },
      { name: 'accountId', label: 'Llega a', type: 'select', value: i.accountId, options: accountOptions(ctx.s) },
      { name: 'from', label: 'Desde (opcional)', type: 'date', value: i.from },
      { name: 'until', label: 'Hasta (opcional)', type: 'date', value: i.until },
    ],
    onSubmit: v => {
      const days = [...new Set(String(v.days).split(/[^\d]+/).map(Number).filter(d => d >= 1 && d <= 31))].sort((a, b) => a - b);
      if (!days.length) return 'Escribe al menos un día del mes (1 a 31).';
      ctx.commit(s => {
        const data = { ...v, days };
        if (isNew) s.incomes.push({ id: uid(), ...data });
        else Object.assign(s.incomes.find(x => x.id === i.id), data);
      });
    },
    onDelete: isNew ? null : () => ctx.commit(s => { s.incomes = s.incomes.filter(x => x.id !== i.id); }),
  });
}

function fixedForm(ctx, f) {
  const isNew = !f;
  f ??= { currency: 'COP', active: true };
  openForm({
    title: isNew ? 'Nuevo gasto fijo' : f.name,
    fields: [
      { name: 'name', label: 'Qué es', value: f.name, placeholder: 'Spotify', required: true },
      { name: 'currency', label: 'Moneda', type: 'select', value: f.currency, options: currencyOptions },
      { name: 'amount', label: 'Monto', type: 'money', decimal: true, value: f.currency === 'USD' ? f.amount : fmtPlain(f.amount), required: true, hint: 'En dólares puedes poner decimales: 20,50' },
      { name: 'day', label: 'Día del mes en que se cobra', type: 'number', value: f.day, min: 1, max: 31, required: true },
      { name: 'accountId', label: 'Se paga con', type: 'select', value: f.accountId, options: accountOptions(ctx.s) },
      { name: 'from', label: 'Desde (opcional)', type: 'date', value: f.from },
      { name: 'until', label: 'Hasta (opcional)', type: 'date', value: f.until },
      { name: 'active', label: 'Activo', type: 'checkbox', value: f.active !== false },
    ],
    onSubmit: v => {
      if (!(v.day >= 1 && v.day <= 31)) return 'El día debe estar entre 1 y 31.';
      ctx.commit(s => {
        if (isNew) s.fixed.push({ id: uid(), ...v });
        else Object.assign(s.fixed.find(x => x.id === f.id), v);
      });
    },
    onDelete: isNew ? null : () => ctx.commit(s => { s.fixed = s.fixed.filter(x => x.id !== f.id); }),
  });
}

function debtForm(ctx, d, modeOverride) {
  const isNew = !d;
  d = d ? { ...d } : { mode: 'cuota' };
  const mode = modeOverride || d.mode;
  const common = [
    { name: 'name', label: 'Nombre', value: d.name, placeholder: mode === 'pagos' ? 'Tarjeta de crédito' : 'Celular', required: true },
    { name: 'accountId', label: 'Se paga desde', type: 'select', value: d.accountId, options: accountOptions(ctx.s) },
  ];
  const fields = mode === 'pagos'
    ? [...common, { name: 'payments', label: 'Pagos que faltan', type: 'payments', value: d.payments, hint: 'Una fila por pago: fecha límite y monto.' }]
    : [...common,
      { name: 'amount', label: 'Valor de la cuota', type: 'money', value: d.amount, required: true },
      { name: 'day', label: 'Día del mes en que se paga', type: 'number', value: d.day, min: 1, max: 31, required: true },
      { name: 'first', label: 'Primer pago que falta', type: 'date', value: d.first || today(), required: true },
      { name: 'until', label: 'Último pago', type: 'date', value: d.until, required: true },
      ...((ctx.s.goals || []).length ? [
        { name: 'r1Goal', label: 'Cuando termine, esa cuota se va a la meta', type: 'select', value: d.redirects?.[0]?.goalId, options: goalOptions(ctx.s, 'A ninguna (queda libre)') },
        { name: 'r1Amount', label: 'Cuánto de la cuota (vacío = toda)', type: 'money', value: d.redirects?.[0]?.amount },
        { name: 'r2Goal', label: 'Y el resto a otra meta (opcional)', type: 'select', value: d.redirects?.[1]?.goalId, options: goalOptions(ctx.s) },
        { name: 'r2Amount', label: 'Cuánto a esa otra meta', type: 'money', value: d.redirects?.[1]?.amount },
      ] : [{ name: 'n', type: 'note', label: 'Cuando crees metas de ahorro, aquí podrás mandar esta cuota a una meta cuando la deuda termine.' }])];
  openForm({
    title: isNew ? (mode === 'pagos' ? 'Deuda con pagos distintos' : 'Deuda en cuotas iguales') : d.name,
    intro: mode === 'pagos'
      ? 'Para la tarjeta de crédito o cualquier deuda donde cada pago es distinto.'
      : 'Para algo que pagas igual cada mes hasta una fecha (celular, préstamo).',
    fields,
    extra: [{ label: mode === 'pagos' ? 'Cambiar a cuotas iguales' : 'Cambiar a pagos distintos', onClick: v => debtForm(ctx, isNew ? null : { ...d, ...v }, mode === 'pagos' ? 'cuota' : 'pagos') }],
    onSubmit: v => {
      if (mode === 'pagos' && !v.payments.length) return 'Agrega al menos un pago con fecha y monto.';
      if (mode === 'cuota' && v.until < v.first) return 'El último pago no puede ser antes del primero.';
      ctx.commit(s => {
        const { r1Goal, r1Amount, r2Goal, r2Amount, ...rest } = v;
        const data = { ...rest, mode };
        if (mode === 'cuota' && (s.goals || []).length) {
          data.redirects = [[r1Goal, r1Amount], [r2Goal, r2Amount]].filter(([gid]) => gid).map(([goalId, amount]) => ({ goalId, amount: amount || 0 }));
        }
        if (isNew) s.debts.push({ id: uid(), ...data });
        else Object.assign(s.debts.find(x => x.id === d.id), data);
      });
    },
    onDelete: isNew ? null : () => ctx.commit(s => { s.debts = s.debts.filter(x => x.id !== d.id); }),
  });
}

const goalOptions = (s, emptyLabel = 'Ninguna') =>
  [{ value: '', label: emptyLabel }, ...(s.goals || []).map(g => ({ value: g.id, label: g.name }))];

function goalForm(ctx, g) {
  const isNew = !g;
  g ??= { active: true };
  openForm({
    title: isNew ? 'Nueva meta' : g.name,
    intro: 'Plata que juntas para algo. Lo que aportas sale de lo libre de cada quincena.',
    fields: [
      { name: 'name', label: 'Para qué', value: g.name, placeholder: 'Colchón de emergencia', required: true },
      { name: 'target', label: 'Cuánto quieres juntar (opcional)', type: 'money', value: g.target },
      { name: 'saved', label: 'Lo que ya tienes ahorrado para esto', type: 'money', value: g.saved },
      { name: 'perQuincena', label: 'Aporte fijo cada quincena (opcional)', type: 'money', value: g.perQuincena, hint: 'También puedes mandar aquí la cuota de una deuda cuando termine (en Plan → Deudas).' },
      { name: 'from', label: 'Empezar a aportar desde (opcional)', type: 'date', value: g.from },
      { name: 'accountId', label: 'Dónde guardas esta plata', type: 'select', value: g.accountId, options: accountOptions(ctx.s) },
      { name: 'active', label: 'Activa', type: 'checkbox', value: g.active !== false },
    ],
    onSubmit: v => ctx.commit(s => {
      s.goals ??= [];
      if (isNew) s.goals.push({ id: uid(), ...v });
      else Object.assign(s.goals.find(x => x.id === g.id), v);
    }),
    onDelete: isNew ? null : () => ctx.commit(s => {
      s.goals = s.goals.filter(x => x.id !== g.id);
      for (const d of s.debts) if (d.redirects) d.redirects = d.redirects.filter(r => r.goalId !== g.id);
    }),
  });
}

function budgetForm(ctx, b) {
  const isNew = !b;
  b ??= { active: true };
  openForm({
    title: isNew ? 'Nuevo presupuesto' : b.name,
    fields: [
      { name: 'name', label: 'Para qué', value: b.name, placeholder: 'Mercado', required: true },
      { name: 'amount', label: 'Cuánto por quincena', type: 'money', value: b.amount, required: true },
      { name: 'active', label: 'Activo', type: 'checkbox', value: b.active !== false },
    ],
    onSubmit: v => ctx.commit(s => {
      if (isNew) s.budgets.push({ id: uid(), ...v });
      else Object.assign(s.budgets.find(x => x.id === b.id), v);
    }),
    onDelete: isNew ? null : () => ctx.commit(s => { s.budgets = s.budgets.filter(x => x.id !== b.id); }),
  });
}

const KIND_TITLES = { gasto: 'gasto', ingreso: 'ingreso extra', pago: 'pago de esta quincena', ahorro: 'aporte a una meta' };

function movementForm(ctx, m, kind, preset = {}) {
  const isNew = !m;
  const { s } = ctx;
  m = m ? { ...m } : { kind, date: defaultDate(ctx), currency: 'COP', ...preset };
  kind = m.kind;
  const fields = kind === 'ahorro' ? [
    { name: 'goalId', label: 'Meta', type: 'select', value: m.goalId || s.goals?.[0]?.id, options: goalOptions(s).slice(1) },
  ] : [
    { name: 'concept', label: 'Concepto', value: m.concept, placeholder: kind === 'gasto' ? 'Almuerzo' : kind === 'ingreso' ? 'Me pagó un amigo' : 'Bus a casa', required: true },
    { name: 'currency', label: 'Moneda', type: 'select', value: m.currency || 'COP', options: currencyOptions },
    { name: 'amount', label: 'Monto', type: 'money', decimal: true, value: m.currency === 'USD' ? m.original : fmtPlain(m.amount), required: true },
  ];
  if (kind === 'gasto') fields.push({ name: 'budgetId', label: 'Presupuesto', type: 'select', value: m.budgetId, options: budgetOptions(s) });
  fields.push(
    { name: 'accountId', label: kind === 'ingreso' || kind === 'ahorro' ? 'Va a la cuenta' : 'Pagado con', type: 'select', value: m.accountId, options: accountOptions(s) },
    { name: 'date', label: 'Fecha', type: 'date', value: m.date, required: true },
  );
  if (kind === 'pago') fields.push({ name: 'separated', label: 'Ya separé la plata', type: 'checkbox', value: m.separated });
  if (kind !== 'gasto') fields.push({ name: 'done', label: kind === 'ingreso' ? 'Ya llegó' : kind === 'ahorro' ? 'Ya lo pasé al ahorro' : 'Ya lo pagué', type: 'checkbox', value: m.done });

  openForm({
    title: isNew ? `Nuevo ${KIND_TITLES[kind]}` : m.concept,
    fields,
    onSubmit: v => {
      const data = {
        kind, date: v.date, accountId: v.accountId,
        concept: kind === 'ahorro' ? `Ahorro: ${s.goals.find(g => g.id === v.goalId)?.name || 'meta'}` : v.concept,
        goalId: kind === 'ahorro' ? v.goalId : undefined,
        currency: v.currency, original: v.currency === 'USD' ? v.amount : null,
        amount: toCop(v.amount, v.currency, s),
        budgetId: kind === 'gasto' ? v.budgetId : undefined,
        done: kind === 'gasto' ? true : !!v.done,
        separated: kind === 'pago' && !v.done && !!v.separated,
      };
      ctx.commit(st => {
        if (isNew) st.movements.push({ id: uid(), ...data });
        else Object.assign(st.movements.find(x => x.id === m.id), data);
      });
      if (isNew && qOf(v.date) !== ctx.ui.q) toast(`Quedó en ${qTitle(qOf(v.date))}`);
    },
    onDelete: isNew ? null : () => ctx.commit(st => { st.movements = st.movements.filter(x => x.id !== m.id); }),
  });
}

// Si estás viendo otra quincena, la fecha por defecto es el inicio de esa quincena.
function defaultDate(ctx) {
  const t = today();
  return qOf(t) === ctx.ui.q ? t : build(ctx.s, ctx.ui.q).range.start;
}

// ================================================================
// ACCIONES (data-act)
// ================================================================

const findIn = (arr, id) => arr.find(x => x.id === id);

export const actions = {
  ...nubeActions,
  'go-q': (ctx, d) => { ctx.ui.q = d.q; if (location.hash !== '#quincena') location.hash = '#quincena'; else ctx.render(); },
  'sav-toggle': (ctx, d) => toggleItem(ctx, d.key, false),
  'sav-edit': (ctx, d) => editItem(ctx, d.key, 'ahorro'),
  'goal-add': ctx => goalForm(ctx),
  'goal-edit': (ctx, d) => goalForm(ctx, findIn(ctx.s.goals, d.id)),
  'q-prev': ctx => { ctx.ui.q = qShift(ctx.ui.q, -1); ctx.render(); },
  'q-next': ctx => { ctx.ui.q = qShift(ctx.ui.q, 1); ctx.render(); },
  'q-today': ctx => { ctx.ui.q = qOf(today()); ctx.render(); },
  'q-review': ctx => { ctx.commit(s => { ensureRec(s, ctx.ui.q).reviewedAt = today(); }); toast('Revisión anotada'); },
  'q-start': ctx => {
    const b = ctx.cur;
    openForm({
      title: '¿Con cuánto arrancas?',
      intro: 'La plata que tienes al empezar la quincena, antes de que llegue el pago. Suma tus cuentas, sin plata que no sea tuya.',
      fields: [{ name: 'start', label: 'Arrancas con', type: 'money', value: b.start.value }],
      extra: b.start.set ? [{ label: 'Usar lo que sobró antes', onClick: () => ctx.commit(s => { delete ensureRec(s, ctx.ui.q).start; }) }] : [],
      onSubmit: v => ctx.commit(s => { ensureRec(s, ctx.ui.q).start = v.start; }),
    });
  },

  // Ingresos y pagos con checkbox
  'inc-toggle': (ctx, d) => toggleItem(ctx, d.key, false),
  'pay-toggle': (ctx, d) => toggleItem(ctx, d.key, true),
  'inc-edit': (ctx, d) => editItem(ctx, d.key, 'ingreso'),
  'pay-edit': (ctx, d) => editItem(ctx, d.key, 'pago'),

  'mov-add': (ctx, d) => movementForm(ctx, null, d.kind),
  'mov-edit': (ctx, d) => movementForm(ctx, findIn(ctx.s.movements, d.id)),

  'budget-open': (ctx, d) => {
    const x = ctx.cur.budgets.find(b => b.id === d.id);
    openForm({
      title: x.name,
      intro: `Gastado ${fmt(x.spent)} de ${fmt(x.amount)} en esta quincena.`,
      fields: [{ name: 'amount', label: 'Presupuesto solo para esta quincena', type: 'money', value: x.amount, hint: `Normalmente es ${fmt(x.base)}.` }],
      submitLabel: 'Guardar monto',
      extra: [{ label: 'Anotar gasto aquí', kind: 'primary-ghost', onClick: () => movementForm(ctx, null, 'gasto', { budgetId: x.id, concept: x.name }) }],
      onSubmit: v => ctx.commit(s => {
        const rec = ensureRec(s, ctx.ui.q);
        if (v.amount === x.base) delete rec.budgetOverrides[x.id];
        else rec.budgetOverrides[x.id] = v.amount;
      }),
    });
  },

  'task-toggle': (ctx, d) => ctx.commit(s => { const t = findIn(ensureRec(s, ctx.ui.q).tasks, d.id); t.done = !t.done; }),
  'task-edit': (ctx, d) => {
    const t = findIn(ctx.cur.tasks, d.id);
    openForm({
      title: 'Pendiente',
      fields: [{ name: 'text', label: 'Qué hay que hacer', value: t.text, required: true }],
      onSubmit: v => ctx.commit(s => { findIn(ensureRec(s, ctx.ui.q).tasks, d.id).text = v.text; }),
      onDelete: () => ctx.commit(s => { const r = ensureRec(s, ctx.ui.q); r.tasks = r.tasks.filter(x => x.id !== d.id); }),
    });
  },

  'reserve-add': ctx => reserveForm(ctx),
  'reserve-edit': (ctx, d) => reserveForm(ctx, findIn(ctx.cur.reserves, d.id)),

  'balance-edit': (ctx, d) => {
    const a = findIn(ctx.s.accounts, d.id);
    openForm({
      title: `Saldo de ${a.name}`,
      fields: [{ name: 'balance', label: a.type === 'credito' ? 'Lo que debes hoy' : 'Lo que tienes hoy', type: 'money', value: a.balance }],
      onSubmit: v => ctx.commit(s => { findIn(s.accounts, d.id).balance = v.balance; }),
    });
  },

  // Plan
  'income-add': ctx => incomeForm(ctx),
  'income-edit': (ctx, d) => incomeForm(ctx, findIn(ctx.s.incomes, d.id)),
  'fixed-add': ctx => fixedForm(ctx),
  'fixed-edit': (ctx, d) => fixedForm(ctx, findIn(ctx.s.fixed, d.id)),
  'debt-add': ctx => debtForm(ctx),
  'debt-edit': (ctx, d) => debtForm(ctx, findIn(ctx.s.debts, d.id)),
  'budget-add': ctx => budgetForm(ctx),
  'budget-edit': (ctx, d) => budgetForm(ctx, findIn(ctx.s.budgets, d.id)),

  // Cuentas
  'account-add': ctx => accountForm(ctx),
  'account-edit': (ctx, d) => accountForm(ctx, findIn(ctx.s.accounts, d.id)),
  'settings-edit': ctx => openForm({
    title: 'Ajustes',
    fields: [
      { name: 'usdAuto', label: 'Dólar con el cambio real', type: 'checkbox', value: ctx.s.settings.usdAuto !== false, hint: 'Se actualiza solo cada vez que abres la app. Si escribes un precio a mano, queda fijo.' },
      { name: 'usdRate', label: 'Precio del dólar (COP)', type: 'money', value: ctx.s.settings.usdRate },
      { name: 'minimo', label: 'Colchón mínimo por quincena', type: 'money', value: ctx.s.settings.minimo },
      { name: 'name', label: 'Cómo te saluda la app', value: ctx.s.settings.name, placeholder: 'Tu nombre' },
      { name: 'ownName', label: 'Tu nombre completo como sale en el banco', value: ctx.s.settings.ownName, hint: 'Así los SMS reconocen cuando te pasas plata a ti mismo.' },
    ],
    onSubmit: v => {
      const typedRate = v.usdRate !== ctx.s.settings.usdRate;
      ctx.commit(s => {
        s.settings.minimo = v.minimo;
        s.settings.name = v.name;
        s.settings.ownName = v.ownName;
        s.settings.usdRate = v.usdRate || s.settings.usdRate;
        s.settings.usdAuto = typedRate ? false : v.usdAuto;
        if (s.settings.usdAuto) s.settings.usdUpdatedAt = null; // fuerza a traer el precio ya
      });
      if (ctx.s.settings.usdAuto) ctx.refreshRate(true);
      if (typedRate) toast('Dólar fijo en el precio que pusiste');
    },
  }),
  'usd-refresh': async ctx => {
    toast('Buscando el precio del dólar…');
    toast(await ctx.refreshRate(true) ? 'Dólar actualizado' : 'No se pudo actualizar. ¿Hay internet?');
  },
  'export': ctx => { exportJson(ctx.s); toast('Respaldo descargado'); },
  'wipe': ctx => {
    if (!confirm('Esto borra TODOS tus datos de este dispositivo. ¿Seguro?')) return;
    if (!confirm('Última confirmación: ¿borrar todo?')) return;
    ctx.replace(emptyState());
    toast('Datos borrados');
  },

  // ¿Me alcanza?
  'af-cur': (ctx, d) => { ctx.ui.af.currency = d.cur; ctx.ui.af.text = ''; ctx.render(); document.getElementById('af-amount')?.focus(); },
  'af-when': (ctx, d) => { ctx.ui.af.when = d.when; ctx.render(); },
  'af-record': ctx => {
    const af = ctx.ui.af;
    const amount = parseMoney(af.text, af.currency);
    const date = af.when === 'next' ? build(ctx.s, qShift(qOf(today()), 1)).range.start : today();
    movementForm(ctx, null, 'gasto', {
      currency: af.currency, amount: af.currency === 'USD' ? undefined : amount, original: af.currency === 'USD' ? amount : undefined,
      budgetId: af.budgetId, date,
    });
  },
};

// Acciones que vienen de formularios y cambios de input
export const forms = {
  task: (ctx, form) => {
    const text = form.elements.text.value.trim();
    if (!text) return;
    ctx.commit(s => { ensureRec(s, ctx.ui.q).tasks.push({ id: uid(), text, done: false }); });
    requestAnimationFrame(() => document.querySelector('[data-form="task"] input')?.focus());
  },
};

export const changes = {
  import: async (ctx, input) => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const data = parseImport(await file.text());
      if (!confirm('Esto reemplaza los datos actuales por los del respaldo. ¿Seguir?')) return;
      ctx.replace(data);
      toast('Respaldo cargado');
    } catch (e) {
      alert(e.message || 'No se pudo leer el archivo.');
    } finally {
      input.value = '';
    }
  },
};

// Ingresos: vacío ↔ llegó. Pagos: vacío → plata separada → pagado → vacío.
function nextState(x, withSeparated) {
  if (!withSeparated) { x.done = !x.done; return; }
  if (x.done) { x.done = false; x.separated = false; }
  else if (x.separated) { x.done = true; x.separated = false; }
  else x.separated = true;
}

function toggleItem(ctx, key, withSeparated) {
  if (key.startsWith('mov:')) {
    const id = key.slice(4);
    ctx.commit(s => nextState(findIn(s.movements, id), withSeparated));
    return;
  }
  ctx.commit(s => {
    const rec = ensureRec(s, ctx.ui.q);
    const c = rec.checks[key] ?? {};
    nextState(c, withSeparated);
    rec.checks[key] = c;
  });
}

function editItem(ctx, key, kind) {
  const it = [...ctx.cur.incomes, ...ctx.cur.payments, ...ctx.cur.savings].find(x => x.key === key);
  if (!it) return;
  if (it.src.type === 'movement') return movementForm(ctx, findIn(ctx.s.movements, it.src.id));
  const sources = {
    income: ['Editar el ingreso fijo', () => incomeForm(ctx, findIn(ctx.s.incomes, it.src.id))],
    fixed: ['Editar el gasto fijo', () => fixedForm(ctx, findIn(ctx.s.fixed, it.src.id))],
    debt: ['Editar la deuda', () => debtForm(ctx, findIn(ctx.s.debts, it.src.id))],
    account: ['Editar la cuenta', () => accountForm(ctx, findIn(ctx.s.accounts, it.src.id))],
    goal: ['Editar la meta', () => goalForm(ctx, findIn(ctx.s.goals, it.src.id))],
  };
  const [label, open] = sources[it.src.type];
  openForm({
    title: `${it.concept} · ${fmtDate(it.date)}`,
    intro: kind === 'ingreso' ? 'Si esta vez llegó otra cifra, cámbiala aquí. Solo afecta esta quincena.'
      : kind === 'ahorro' ? 'Si esta vez aportas otra cifra, cámbiala aquí. Solo afecta esta quincena.' : 'Si esta vez el cobro fue distinto, pon el monto real. Solo afecta esta quincena.',
    fields: [
      { name: 'amount', label: 'Monto real', type: 'money', value: it.amount, hint: `Lo planeado es ${fmt(it.planned)}.` },
      ...(kind === 'pago' ? [{ name: 'separated', label: 'Ya separé la plata', type: 'checkbox', value: it.separated }] : []),
      { name: 'done', label: kind === 'ingreso' ? 'Ya llegó' : kind === 'ahorro' ? 'Ya lo pasé al ahorro' : 'Ya lo pagué', type: 'checkbox', value: it.done },
    ],
    extra: [{ label, onClick: open }],
    onSubmit: v => ctx.commit(s => {
      const rec = ensureRec(s, ctx.ui.q);
      const c = rec.checks[key] ?? {};
      c.done = v.done;
      c.separated = !v.done && !!v.separated;
      if (v.amount === it.planned) delete c.amount; else c.amount = v.amount;
      rec.checks[key] = c;
    }),
  });
}

function reserveForm(ctx, r) {
  const isNew = !r;
  r ??= {};
  openForm({
    title: isNew ? 'Apartar plata' : r.concept,
    intro: 'Plata que sobra pero ya tiene destino (por ejemplo, un pago grande de la próxima quincena). Se descuenta de lo libre.',
    fields: [
      { name: 'concept', label: 'Para qué', value: r.concept, placeholder: 'Cuota del celular del 1 dic', required: true },
      { name: 'all', label: 'Apartar todo lo que sobre', type: 'checkbox', value: !!r.all, hint: 'Se ajusta solo si algo cambia (por ejemplo, el dólar).' },
      { name: 'amount', label: 'Cuánto (si no apartas todo)', type: 'money', value: r.all ? '' : r.amount },
    ],
    onSubmit: v => {
      if (!v.all && !v.amount) return 'Pon cuánto quieres apartar, o marca "Apartar todo lo que sobre".';
      const data = { concept: v.concept, all: v.all, amount: v.all ? 0 : v.amount };
      ctx.commit(s => {
        const rec = ensureRec(s, ctx.ui.q);
        if (isNew) rec.reserves.push({ id: uid(), ...data });
        else Object.assign(findIn(rec.reserves, r.id), data);
      });
    },
    onDelete: isNew ? null : () => ctx.commit(s => { const rec = ensureRec(s, ctx.ui.q); rec.reserves = rec.reserves.filter(x => x.id !== r.id); }),
  });
}

