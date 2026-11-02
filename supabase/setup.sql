-- Finanzas · nube
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una vez sin problema.
--
-- finanzas       : un registro por persona con todos sus datos (JSON) y un resumen para los Atajos.
-- atajos_inbox   : gastos que llegan desde Atajos de Apple; la app los recoge al sincronizar.
-- atajo_*        : funciones que llaman los Atajos con la clave personal (sin iniciar sesión).

create table if not exists public.finanzas (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  summary jsonb,
  shortcut_key text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  updated_at timestamptz not null default now()
);

create table if not exists public.atajos_inbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  movement jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.finanzas enable row level security;
alter table public.atajos_inbox enable row level security;

drop policy if exists "solo mis datos" on public.finanzas;
create policy "solo mis datos" on public.finanzas for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "solo mi bandeja" on public.atajos_inbox;
create policy "solo mi bandeja" on public.atajos_inbox for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.finanzas, public.atajos_inbox from anon;
grant select, insert, update, delete on public.finanzas, public.atajos_inbox to authenticated;

-- updated_at siempre lo pone el servidor (sirve para detectar cambios desde otro dispositivo).
create or replace function public.tocar_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists finanzas_updated_at on public.finanzas;
create trigger finanzas_updated_at before update on public.finanzas
  for each row execute function public.tocar_updated_at();

-- ---------- Ayudas ----------

-- "45.000" · "45000" · "$45.000,00" · "20.5" -> número
create or replace function public.parse_monto(t text) returns numeric
language plpgsql immutable set search_path = '' as $$
declare
  c text := regexp_replace(coalesce(t, ''), '[^0-9.,]', '', 'g');
  dec text;
begin
  if c = '' then return 0; end if;
  dec := substring(c from '[.,]([0-9]{1,2})$');
  if dec is not null then c := regexp_replace(c, '[.,][0-9]{1,2}$', ''); end if;
  c := regexp_replace(c, '[.,]', '', 'g');
  if c = '' then c := '0'; end if;
  return (c || coalesce('.' || dec, ''))::numeric;
end $$;

-- 1400000 -> "$1.400.000"
create or replace function public.fmt_cop(n numeric) returns text
language sql immutable set search_path = '' as $$
  select case when n < 0 then '−$' else '$' end || replace(to_char(abs(round(n)), 'FM999,999,999,999'), ',', '.')
$$;

-- Gastos de atajos que la app todavía no ha recogido (para que los mensajes no queden viejos).
create or replace function public.pendiente_atajos(uid uuid, bid text) returns numeric
language sql stable set search_path = '' as $$
  select coalesce(sum((movement->>'amount')::numeric), 0) from public.atajos_inbox
  where user_id = uid and movement->>'kind' = 'gasto' and coalesce(movement->>'budgetId', '') = coalesce(bid, '')
$$;

create or replace function public.buscar_presupuesto(r_data jsonb, nombre text, out bid text, out bname text)
language sql stable set search_path = '' as $$
  select b->>'id', b->>'name' from jsonb_array_elements(coalesce(r_data->'budgets', '[]'::jsonb)) b
  where coalesce(trim(nombre), '') <> '' and lower(b->>'name') like lower(trim(nombre)) || '%'
  limit 1
$$;

-- ---------- Funciones para Atajos de Apple ----------

-- Responden texto limpio (sin comillas) para que Siri y Atajos lo lean directo.
do $$ begin
  create domain "text/plain" as text;
exception when duplicate_object then null;
end $$;

drop function if exists public.atajo_gasto(text, text, text, text, text, text);
drop function if exists public.atajo_resumen(text);
drop function if exists public.atajo_alcanza(text, text, text, text);

-- Anota un gasto. Devuelve un mensaje para mostrar o decir en voz alta.
create or replace function public.atajo_gasto(
  clave text, monto text, concepto text default null, presupuesto text default null,
  cuenta text default null, moneda text default 'COP'
) returns "text/plain"
language plpgsql security definer set search_path = '' as $$
declare
  r public.finanzas%rowtype;
  cur text := upper(coalesce(nullif(trim(moneda), ''), 'COP'));
  v numeric; cop numeric; bid text; bname text; aid text; nombre text; left_ numeric; msg text;
begin
  select * into r from public.finanzas where shortcut_key = clave;
  if not found then return 'No reconozco esa clave. Revísala en la app: Cuentas → Atajos de Apple.'; end if;

  v := public.parse_monto(monto);
  if v <= 0 then return 'No entendí el monto.'; end if;
  cop := case when cur = 'USD' then round(v * coalesce((r.data->'settings'->>'usdRate')::numeric, 4000)) else round(v) end;

  select p.bid, p.bname into bid, bname from public.buscar_presupuesto(r.data, presupuesto) p;
  if coalesce(trim(cuenta), '') <> '' then
    select a->>'id' into aid from jsonb_array_elements(coalesce(r.data->'accounts', '[]'::jsonb)) a
    where lower(a->>'name') like lower(trim(cuenta)) || '%' limit 1;
  end if;
  nombre := coalesce(nullif(trim(concepto), ''), bname, 'Gasto');

  insert into public.atajos_inbox (user_id, movement) values (r.user_id, jsonb_build_object(
    'id', 'at' || substr(md5(random()::text || clock_timestamp()::text), 1, 10),
    'kind', 'gasto',
    'date', to_char(now() at time zone 'America/Bogota', 'YYYY-MM-DD'),
    'concept', nombre, 'amount', cop, 'currency', cur,
    'original', case when cur = 'USD' then v else null end,
    'budgetId', bid, 'accountId', aid, 'done', true, 'via', 'atajo'));

  msg := 'Anotado: ' || nombre || ' por ' || public.fmt_cop(cop) || '.';
  if bid is not null then
    select (b->>'left')::numeric into left_ from jsonb_array_elements(coalesce(r.summary->'budgets', '[]'::jsonb)) b where b->>'id' = bid;
    if left_ is not null then
      msg := msg || ' Te quedan ' || public.fmt_cop(left_ - public.pendiente_atajos(r.user_id, bid)) || ' en ' || bname || '.';
    end if;
  elsif r.summary ? 'libre' then
    msg := msg || ' Te quedan ' || public.fmt_cop((r.summary->>'libre')::numeric - public.pendiente_atajos(r.user_id, null)) || ' libres esta quincena.';
  end if;
  return msg;
end $$;

-- "¿Cuánto tengo libre?"
create or replace function public.atajo_resumen(clave text) returns "text/plain"
language plpgsql security definer set search_path = '' as $$
declare
  r public.finanzas%rowtype; libre numeric; nx jsonb; msg text;
begin
  select * into r from public.finanzas where shortcut_key = clave;
  if not found then return 'No reconozco esa clave. Revísala en la app: Cuentas → Atajos de Apple.'; end if;
  if r.summary is null then return 'Abre la app una vez para preparar tu resumen.'; end if;
  libre := (r.summary->>'libre')::numeric - public.pendiente_atajos(r.user_id, null);
  msg := 'Tienes ' || public.fmt_cop(libre) || ' libres en ' || (r.summary->>'quincena') || '.';
  nx := r.summary->'next'->0;
  if nx is not null then
    msg := msg || ' Tu próximo pago es ' || (nx->>'concept') || ', el ' || (nx->>'fecha') || ', por ' || public.fmt_cop((nx->>'amount')::numeric) || '.';
  end if;
  return msg;
end $$;

-- "¿Me alcanza para…?"
create or replace function public.atajo_alcanza(clave text, monto text, presupuesto text default null, moneda text default 'COP') returns "text/plain"
language plpgsql security definer set search_path = '' as $$
declare
  r public.finanzas%rowtype;
  cur text := upper(coalesce(nullif(trim(moneda), ''), 'COP'));
  v numeric; cop numeric; libre numeric; minimo numeric; bid text; bname text; left_ numeric; extra numeric; after_ numeric;
begin
  select * into r from public.finanzas where shortcut_key = clave;
  if not found then return 'No reconozco esa clave. Revísala en la app: Cuentas → Atajos de Apple.'; end if;
  if r.summary is null then return 'Abre la app una vez para preparar tu resumen.'; end if;
  v := public.parse_monto(monto);
  if v <= 0 then return 'No entendí el monto.'; end if;
  cop := case when cur = 'USD' then round(v * coalesce((r.data->'settings'->>'usdRate')::numeric, 4000)) else round(v) end;
  libre := (r.summary->>'libre')::numeric - public.pendiente_atajos(r.user_id, null);
  minimo := coalesce((r.summary->>'minimo')::numeric, 0);

  select p.bid, p.bname into bid, bname from public.buscar_presupuesto(r.data, presupuesto) p;
  extra := cop;
  if bid is not null then
    select (b->>'left')::numeric into left_ from jsonb_array_elements(coalesce(r.summary->'budgets', '[]'::jsonb)) b where b->>'id' = bid;
    left_ := greatest(coalesce(left_, 0) - public.pendiente_atajos(r.user_id, bid), 0);
    if cop <= left_ then
      return 'Sí. Entra en tu presupuesto de ' || bname || ': te quedarían ' || public.fmt_cop(left_ - cop) || '.';
    end if;
    extra := cop - left_;
  end if;
  after_ := libre - extra;
  if after_ >= minimo then return 'Sí te alcanza. Te quedarían ' || public.fmt_cop(after_) || ' libres.'; end if;
  if after_ >= 0 then return 'Te alcanza, pero queda justo: te quedarían ' || public.fmt_cop(after_) || '.'; end if;
  return 'No te alcanza. Te faltarían ' || public.fmt_cop(-after_) || '.';
end $$;

revoke execute on function public.atajo_gasto(text, text, text, text, text, text) from public;
revoke execute on function public.atajo_resumen(text) from public;
revoke execute on function public.atajo_alcanza(text, text, text, text) from public;
grant execute on function public.atajo_gasto(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.atajo_resumen(text) to anon, authenticated;
grant execute on function public.atajo_alcanza(text, text, text, text) to anon, authenticated;

-- Las ayudas solo las usan las funciones de arriba.
revoke execute on function public.pendiente_atajos(uuid, text) from public, anon, authenticated;
revoke execute on function public.buscar_presupuesto(jsonb, text) from public, anon, authenticated;


-- ---------- Lector de SMS del banco ----------

create or replace function public.sin_tildes(t text) returns text
language sql immutable set search_path = '' as $$
  select upper(translate(coalesce(t, ''), 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'))
$$;

-- Recibe el texto de un SMS (por ejemplo de Bancolombia) y decide qué hacer:
--  · si coincide con un pago o ingreso planeado (por monto, ±2 %), lo deja marcado como hecho;
--  · si es entre tus propias cuentas (por número o por tu nombre), no anota nada;
--  · si no, lo anota como gasto o ingreso.
-- La app aplica lo que quede en atajos_inbox la próxima vez que sincroniza.
drop function if exists public.atajo_mensaje(text, text);
create or replace function public.atajo_mensaje(clave text, texto text) returns "text/plain"
language plpgsql security definer set search_path = '' as $$
declare
  r public.finanzas%rowtype;
  t text := coalesce(texto, '');
  tu text := public.sin_tildes(texto);
  monto numeric; d text; dd int; mm int; yy int; fecha text;
  entra boolean; sale boolean;
  cuenta text; nombre text; comercio text; origen text; quien text;
  propio boolean := false; own_name text; banco_id text; best jsonb; nuevo_id text;
begin
  select * into r from public.finanzas where shortcut_key = clave;
  if not found then return 'No reconozco esa clave.'; end if;

  monto := public.parse_monto(substring(t from '\$\s?([0-9][0-9.,]*)'));
  if monto is null or monto <= 0 then return 'No encontré un monto en el mensaje. No anoté nada.'; end if;

  d := substring(t from 'el ([0-9]{1,2}/[0-9]{1,2}/[0-9]{2,4})');
  if d is not null then
    dd := split_part(d, '/', 1)::int; mm := split_part(d, '/', 2)::int; yy := split_part(d, '/', 3)::int;
    if yy < 100 then yy := yy + 2000; end if;
    fecha := to_char(make_date(yy, mm, dd), 'YYYY-MM-DD');
  else
    fecha := to_char(now() at time zone 'America/Bogota', 'YYYY-MM-DD');
  end if;

  entra := tu ~ '(RECIBISTE|TE CONSIGNARON|TE TRANSFIRIERON|TE ENVIARON|ABONO|RECIBIMOS)';
  sale := not entra and tu ~ '(TRANSFERISTE|COMPRASTE|PAGASTE|RETIRASTE|COMPRA |PAGO DE |RETIRO)';
  if not entra and not sale then return 'Este mensaje no parece un movimiento de plata. No anoté nada.'; end if;

  cuenta := substring(t from 'a la cuenta \*?([0-9]+)');
  nombre := substring(t from ' a ([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .]*[A-ZÁÉÍÓÚÑ]) el [0-9]');
  comercio := substring(t from ' en ([A-Z0-9][A-Z0-9ÁÉÍÓÚÑ .*&-]*[A-Z0-9])');
  origen := trim(substring(t from 'de (.+?) (?:por|en tu|a tu)'));

  -- ¿Entre tus propias cuentas?
  own_name := public.sin_tildes(r.data->'settings'->>'ownName');
  if cuenta is not null then
    select true into propio from jsonb_array_elements(coalesce(r.data->'accounts', '[]'::jsonb)) a
    where length(regexp_replace(coalesce(a->>'ref', ''), '[^0-9]', '', 'g')) >= 4
      and right(regexp_replace(a->>'ref', '[^0-9]', '', 'g'), 4) = right(cuenta, 4)
    limit 1;
  end if;
  quien := public.sin_tildes(coalesce(case when sale then nombre else origen end, ''));
  if own_name <> '' and quien <> '' and (position(own_name in quien) > 0 or position(quien in own_name) > 0) then
    propio := true;
  end if;
  if coalesce(propio, false) then
    return 'Movimiento entre tus cuentas por ' || public.fmt_cop(monto) || '. No es gasto, no lo anoté.';
  end if;

  select a->>'id' into banco_id from jsonb_array_elements(coalesce(r.data->'accounts', '[]'::jsonb)) a
  where public.sin_tildes(a->>'name') like '%' || public.sin_tildes(coalesce(nullif(split_part(t, ':', 1), ''), 'X')) || '%'
  limit 1;
  nuevo_id := 'sm' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);

  -- ¿Coincide con algo planeado?
  select p into best
  from jsonb_array_elements(coalesce(r.summary->(case when sale then 'pending' else 'incoming' end), '[]'::jsonb)) p
  where abs((p->>'amount')::numeric - monto) <= greatest(monto * 0.02, 100)
    and abs((p->>'date')::date - fecha::date) <= 10
    and not exists (select 1 from public.atajos_inbox i where i.user_id = r.user_id and i.movement->>'key' = p->>'key')
  order by abs((p->>'date')::date - fecha::date)
  limit 1;

  if best is not null then
    insert into public.atajos_inbox (user_id, movement) values (r.user_id, jsonb_build_object(
      'id', nuevo_id, 'type', 'check', 'key', best->>'key', 'q', best->>'q',
      'amount', monto, 'planned', (best->>'amount')::numeric, 'via', 'sms'));
    return (best->>'concept') || case when sale then ' marcado como pagado (' else ' marcado como recibido (' end || public.fmt_cop(monto) || ').';
  end if;

  -- ¿Ya estaba registrado a mano (mismo monto, fecha cercana)?
  select p into best from jsonb_array_elements(coalesce(r.summary->'done', '[]'::jsonb)) p
  where abs((p->>'amount')::numeric - monto) <= greatest(monto * 0.02, 100)
    and abs((p->>'date')::date - fecha::date) <= 5
  limit 1;
  if best is not null then
    return 'Ya estaba registrado: ' || (best->>'concept') || ' (' || public.fmt_cop(monto) || '). No lo anoté otra vez.';
  end if;

  if sale then
    insert into public.atajos_inbox (user_id, movement) values (r.user_id, jsonb_build_object(
      'id', nuevo_id, 'kind', 'gasto', 'date', fecha,
      'concept', coalesce(initcap(nombre), comercio, case when cuenta is not null then 'Transferencia a cuenta *' || right(cuenta, 4) end, 'Gasto del banco'),
      'amount', monto, 'currency', 'COP', 'original', null, 'budgetId', null, 'accountId', banco_id, 'done', true, 'via', 'sms'));
    return 'Gasto anotado: ' || coalesce(initcap(nombre), comercio, 'transferencia') || ' por ' || public.fmt_cop(monto) || '.';
  end if;

  insert into public.atajos_inbox (user_id, movement) values (r.user_id, jsonb_build_object(
    'id', nuevo_id, 'kind', 'ingreso', 'date', fecha, 'concept', coalesce(initcap(origen), 'Ingreso del banco'),
    'amount', monto, 'currency', 'COP', 'original', null, 'accountId', banco_id, 'done', true, 'via', 'sms'));
  return 'Ingreso anotado: ' || coalesce(initcap(origen), 'ingreso') || ' por ' || public.fmt_cop(monto) || '.';
end $$;

revoke execute on function public.atajo_mensaje(text, text) from public;
grant execute on function public.atajo_mensaje(text, text) to anon, authenticated;
