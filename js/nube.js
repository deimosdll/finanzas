// Pantalla Cuentas: secciones de Nube (cuenta y sincronización) y Atajos de Apple.

import { esc } from './money.js';
import { openForm, toast } from './forms.js';
import * as sync from './sync.js';

const RPC = name => `${sync.SUPABASE_URL}/rest/v1/rpc/${name}`;

function ago(t) {
  if (!t) return 'nunca';
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}

const copyBtn = (text, label = 'Copiar') => `<button class="btn small" data-act="copy" data-text="${esc(text)}">${label}</button>`;

export function nubeSection() {
  if (!sync.isLoggedIn()) {
    return `
      <p class="muted small">Conecta tu cuenta para tener los mismos datos en el iPhone y en el Mac, y para usar los Atajos de Apple.</p>
      <div class="btn-row">
        <button class="btn primary" data-act="cloud-login">Entrar</button>
        <button class="btn" data-act="cloud-signup">Crear cuenta</button>
      </div>`;
  }
  const m = sync.meta;
  return `
    <div class="row"><span>Cuenta</span><span>${esc(sync.userEmail())}</span></div>
    <div class="row"><span>Última sincronización</span><span>${ago(m.lastSync)}</span></div>
    ${m.dirty ? `<p class="muted small">Hay cambios esperando para subirse.</p>` : ''}
    ${m.error ? `<p class="form-error">${esc(m.error)}</p>` : ''}
    <div class="btn-row">
      <button class="btn" data-act="cloud-sync">Sincronizar ahora</button>
      <button class="btn danger-ghost" data-act="cloud-logout">Cerrar sesión</button>
    </div>`;
}

export function atajosSection() {
  if (!sync.isLoggedIn()) return '';
  const key = sync.meta.shortcutKey;
  if (!key) return `<p class="muted small">Sincroniza una vez para ver tu clave de Atajos.</p>`;

  const step = (n, html) => `<li><span class="step-n">${n}</span><div>${html}</div></li>`;
  const urlBox = name => `<div class="code-row"><code>${RPC(name)}</code>${copyBtn(RPC(name))}</div>`;
  const common = name => `
    ${step('·', `Acción <b>Obtener contenido de URL</b>, con esta dirección: ${urlBox(name)}`)}
    ${step('·', `Toca <b>Mostrar más</b>. Método: <b>POST</b>. Agrega dos encabezados:<br><code>apikey</code> = <code class="wrap">${sync.SUPABASE_KEY}</code> ${copyBtn(sync.SUPABASE_KEY)}<br><code>Accept</code> = <code>text/plain</code> (para que la respuesta llegue limpia)`)}
    ${step('·', `Cuerpo de la solicitud: <b>JSON</b>. Agrega el campo <code>clave</code> (texto) con tu clave ${copyBtn(key, 'Copiar clave')}`)}`;

  return `
    <p class="muted small">Con estos atajos anotas gastos y preguntas por tu plata desde Siri, el iPhone o el Mac, sin abrir la app. Lo que anotes aparece aquí la próxima vez que la abras.</p>
    <div class="row"><span>Tu clave personal</span><span>${copyBtn(key, 'Copiar clave')}</span></div>
    <p class="muted small">La clave deja anotar gastos y leer tu resumen. No la compartas. Abre la app <b>Atajos</b> y crea cada uno con el botón <b>+</b>:</p>

    <details class="recipe"><summary>🗣️ "Oye Siri, anotar gasto"</summary><ol class="steps">
      ${step(1, 'Nombre del atajo: <b>Anotar gasto</b> (así lo llamas con Siri).')}
      ${step(2, 'Acción <b>Solicitar entrada</b> → tipo <b>Número</b>, pregunta: <i>¿Cuánto fue?</i>')}
      ${step(3, 'Acción <b>Solicitar entrada</b> → tipo <b>Texto</b>, pregunta: <i>¿En qué?</i>')}
      ${common('atajo_gasto')}
      ${step(4, 'En el JSON agrega también: <code>monto</code> = la primera entrada, <code>concepto</code> = la segunda. Opcional: <code>presupuesto</code> = "Mercado", "Salidas"… (basta con el comienzo del nombre).')}
      ${step(5, 'Acción <b>Leer texto</b> (o <b>Mostrar resultado</b>) con el <b>Contenido de la URL</b>.')}
    </ol></details>

    <details class="recipe"><summary>💳 Anotar solo cada pago con Apple Pay</summary><ol class="steps">
      ${step(1, 'En Atajos ve a <b>Automatización</b> → <b>+</b> → <b>Transacción</b>. Elige tus tarjetas y marca <b>Ejecutar inmediatamente</b>.')}
      ${common('atajo_gasto')}
      ${step(2, 'En el JSON: <code>monto</code> = <b>Cantidad</b> (de la entrada del atajo) y <code>concepto</code> = <b>Comerciante</b>.')}
      ${step(3, 'Acción <b>Mostrar notificación</b> con el <b>Contenido de la URL</b>.')}
    </ol><p class="muted small">Queda como gasto sin presupuesto. Si era de Mercado o Salidas, tócalo en la quincena y cámbialo.</p></details>

    <details class="recipe"><summary>💬 "Oye Siri, ¿cuánto tengo libre?"</summary><ol class="steps">
      ${step(1, 'Nombre del atajo: <b>Cuánto tengo libre</b>.')}
      ${common('atajo_resumen')}
      ${step(2, 'Acción <b>Leer texto</b> con el <b>Contenido de la URL</b>.')}
    </ol></details>

    <details class="recipe"><summary>🤔 "Oye Siri, ¿me alcanza?"</summary><ol class="steps">
      ${step(1, 'Nombre del atajo: <b>Me alcanza</b>.')}
      ${step(2, 'Acción <b>Solicitar entrada</b> → tipo <b>Número</b>, pregunta: <i>¿Cuánto cuesta?</i>')}
      ${common('atajo_alcanza')}
      ${step(3, 'En el JSON agrega <code>monto</code> = la entrada. Opcional: <code>presupuesto</code>.')}
      ${step(4, 'Acción <b>Leer texto</b> con el <b>Contenido de la URL</b>.')}
    </ol></details>`;
}

function hasData(s) {
  return !!(s.accounts.length || s.incomes.length || s.fixed.length || s.debts.length || s.movements.length);
}

function authForm(ctx, mode) {
  const isNew = mode === 'signup';
  openForm({
    title: isNew ? 'Crear cuenta' : 'Entrar',
    intro: isNew
      ? 'Tu cuenta para guardar tus finanzas en tu nube privada. Te llegará un correo para confirmarla.'
      : 'Entra con el correo y la contraseña de tu cuenta de Finanzas.',
    fields: [
      { name: 'email', label: 'Correo', type: 'email', placeholder: 'tu@correo.com', required: true },
      { name: 'password', label: 'Contraseña', type: 'password', autocomplete: isNew ? 'new-password' : 'current-password', required: true, hint: isNew ? 'Mínimo 6 caracteres. Guárdala en Contraseñas de Apple.' : '' },
    ],
    submitLabel: isNew ? 'Crear cuenta' : 'Entrar',
    onSubmit: async v => {
      try {
        if (isNew) {
          const r = await sync.signUp(v.email, v.password);
          if (!r.session) return 'Listo. Abre el correo que te llegó y confirma tu cuenta. Después toca "Entrar" (no "Crear cuenta").';
        } else {
          await sync.signIn(v.email, v.password);
        }
      } catch (e) {
        return e.message;
      }
      toast('Conectado. Sincronizando…');
      await sync.firstSync(hasData(ctx.s), () => confirm(
        'Ya tienes datos en la nube y también en este dispositivo.\n\nAceptar: usar los de la nube (recomendado si ya los tenías en otro dispositivo).\nCancelar: reemplazar la nube con los de este dispositivo.'));
      ctx.render();
      toast(sync.meta.error ? sync.meta.error : 'Sincronizado');
    },
  });
}

export const nubeActions = {
  'cloud-login': ctx => authForm(ctx, 'login'),
  'cloud-signup': ctx => authForm(ctx, 'signup'),
  'cloud-sync': async ctx => {
    toast('Sincronizando…');
    const ok = await sync.syncNow();
    ctx.render();
    toast(ok ? 'Sincronizado' : (sync.meta.error || 'No se pudo sincronizar'));
  },
  'cloud-logout': async ctx => {
    if (!confirm('¿Cerrar sesión en este dispositivo? Tus datos se quedan aquí y en la nube.')) return;
    await sync.signOut();
    ctx.render();
  },
  'copy': async (ctx, d) => {
    try { await navigator.clipboard.writeText(d.text); toast('Copiado'); }
    catch { prompt('Copia esto:', d.text); }
  },
};
