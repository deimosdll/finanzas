// Hoja inferior genérica para formularios, confirmaciones y avisos.

import { esc, fmtPlain, parseMoney } from './money.js';

const sheet = () => document.getElementById('sheet');

// Campos soportados:
//  { name, label, type: 'text'|'money'|'number'|'date'|'select'|'checkbox'|'textarea'|'payments'|'note',
//    value, options: [{value,label}], placeholder, hint, required, currencyField }
function fieldHtml(f) {
  const id = `f-${f.name}`;
  const hint = f.hint ? `<small class="hint">${esc(f.hint)}</small>` : '';
  const req = f.required ? 'required' : '';
  switch (f.type) {
    case 'note':
      return `<p class="form-note">${esc(f.label)}</p>`;
    case 'money':
      return `<label class="field"><span>${esc(f.label)}</span>
        <input id="${id}" name="${f.name}" inputmode="${f.decimal ? 'decimal' : 'numeric'}" autocomplete="off"
          data-money="${f.decimal ? 'AUTO' : 'COP'}" value="${f.decimal ? esc(f.value ?? '') : fmtPlain(f.value)}"
          placeholder="${esc(f.placeholder ?? '0')}" ${req}>${hint}</label>`;
    case 'select':
      return `<label class="field"><span>${esc(f.label)}</span>
        <select id="${id}" name="${f.name}">${f.options.map(o =>
          `<option value="${esc(o.value)}" ${String(o.value) === String(f.value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>${hint}</label>`;
    case 'checkbox':
      return `<label class="field toggle"><span>${esc(f.label)}</span>
        <input type="checkbox" id="${id}" name="${f.name}" ${f.value ? 'checked' : ''}>${hint}</label>`;
    case 'textarea':
      return `<label class="field"><span>${esc(f.label)}</span>
        <textarea id="${id}" name="${f.name}" rows="3" placeholder="${esc(f.placeholder ?? '')}">${esc(f.value ?? '')}</textarea>${hint}</label>`;
    case 'payments': {
      const rows = (f.value?.length ? f.value : [{ date: '', amount: '' }]);
      return `<div class="field"><span>${esc(f.label)}</span>
        <div class="pay-rows" data-payments="${f.name}">${rows.map(payRow).join('')}</div>
        <button type="button" class="link" data-add-payrow>+ Agregar pago</button>${hint}</div>`;
    }
    default:
      return `<label class="field"><span>${esc(f.label)}</span>
        <input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}"
          ${f.type === 'number' ? 'inputmode="numeric"' : ''} placeholder="${esc(f.placeholder ?? '')}"
          ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} ${req}>${hint}</label>`;
  }
}

const payRow = p => `<div class="pay-row">
  <input type="date" value="${esc(p.date || '')}" aria-label="Fecha del pago">
  <input inputmode="numeric" data-money="COP" value="${fmtPlain(p.amount)}" placeholder="Monto" aria-label="Monto del pago">
  <button type="button" class="icon-btn small" data-del-payrow aria-label="Quitar pago">✕</button></div>`;

// Formatea los montos mientras se escriben: 1400000 -> 1.400.000
function wireMoney(root) {
  root.addEventListener('input', e => {
    const el = e.target;
    const mode = el.dataset?.money;
    // AUTO: pesos o dólares según el campo "Moneda" del mismo formulario.
    if (mode !== 'COP' && !(mode === 'AUTO' && root.elements?.currency?.value !== 'USD')) return;
    const digits = el.value.replace(/\D/g, '');
    el.value = digits ? fmtPlain(Number(digits)) : '';
  });
}

function collect(form, fields) {
  const out = {};
  for (const f of fields) {
    if (f.type === 'note') continue;
    if (f.type === 'payments') {
      out[f.name] = [...form.querySelectorAll(`[data-payments="${f.name}"] .pay-row`)].map(row => {
        const [d, a] = row.querySelectorAll('input');
        return { date: d.value, amount: parseMoney(a.value) };
      }).filter(p => p.date && p.amount);
      continue;
    }
    const el = form.elements[f.name];
    if (!el) continue;
    if (f.type === 'checkbox') out[f.name] = el.checked;
    else if (f.type === 'money') out[f.name] = parseMoney(el.value, f.decimal ? 'USD' : 'COP');
    else if (f.type === 'number') out[f.name] = el.value === '' ? null : Number(el.value);
    else out[f.name] = el.value.trim();
  }
  return out;
}

/**
 * Abre un formulario en la hoja inferior.
 * onSubmit(values) puede devolver un texto de error para no cerrar la hoja.
 * extra: [{ label, onClick, kind }] botones adicionales.
 */
export function openForm({ title, intro, fields, submitLabel = 'Guardar', onSubmit, onDelete, deleteLabel = 'Eliminar', extra = [] }) {
  const dlg = sheet();
  dlg.innerHTML = `
    <form class="sheet" novalidate>
      <header class="sheet-head">
        <h2>${esc(title)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Cerrar">✕</button>
      </header>
      ${intro ? `<p class="sheet-intro">${esc(intro)}</p>` : ''}
      <div class="fields">${fields.map(fieldHtml).join('')}</div>
      <p class="form-error" role="alert"></p>
      <footer class="sheet-foot">
        ${extra.map((x, i) => `<button type="button" class="btn ${x.kind || 'ghost'}" data-extra="${i}">${esc(x.label)}</button>`).join('')}
        ${onDelete ? `<button type="button" class="btn danger" data-delete>${esc(deleteLabel)}</button>` : ''}
        <button type="submit" class="btn primary">${esc(submitLabel)}</button>
      </footer>
    </form>`;
  const form = dlg.querySelector('form');
  wireMoney(form);

  form.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-close')) closeSheet();
    else if (t.hasAttribute('data-delete')) {
      if (confirm('¿Seguro que quieres eliminar esto?')) { closeSheet(); onDelete(); }
    } else if (t.hasAttribute('data-add-payrow')) {
      t.previousElementSibling.insertAdjacentHTML('beforeend', payRow({ date: '', amount: '' }));
    } else if (t.hasAttribute('data-del-payrow')) {
      t.closest('.pay-row').remove();
    } else if (t.dataset.extra != null) {
      const x = extra[Number(t.dataset.extra)];
      closeSheet();
      x.onClick(collect(form, fields));
    }
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const values = collect(form, fields);
    for (const f of fields) {
      if (f.required && (values[f.name] === '' || values[f.name] == null || (f.type === 'money' && !values[f.name]))) {
        form.querySelector('.form-error').textContent = `Falta: ${f.label}`;
        return;
      }
    }
    const err = onSubmit(values);
    if (typeof err === 'string') { form.querySelector('.form-error').textContent = err; return; }
    closeSheet();
  });

  dlg.showModal();
  // Enfoca el primer campo en computador; en el celular no, para no abrir el teclado de golpe.
  if (window.matchMedia('(pointer: fine)').matches) form.querySelector('input:not([type=checkbox]), select')?.focus();
}

export function closeSheet() {
  const dlg = sheet();
  if (dlg.open) dlg.close();
}

// Cierra tocando fuera de la hoja.
export function wireSheet() {
  const dlg = sheet();
  dlg.addEventListener('click', e => { if (e.target === dlg) closeSheet(); });
}

let toastTimer;
export function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

