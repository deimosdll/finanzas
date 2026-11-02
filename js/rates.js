// Precio real del dólar en pesos (USD → COP), desde servicios gratuitos sin cuenta.
// Si el primero falla, prueba el segundo. Sin internet, se queda con el último precio guardado.

const SOURCES = [
  { name: 'ExchangeRate-API', url: 'https://open.er-api.com/v6/latest/USD', pick: j => j?.rates?.COP },
  { name: 'Currency API', url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json', pick: j => j?.usd?.cop },
];

const SIX_HOURS = 6 * 60 * 60 * 1000;

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Devuelve el precio redondeado a peso, o null si ningún servicio respondió bien.
export async function fetchUsdCop() {
  for (const src of SOURCES) {
    try {
      const v = Number(src.pick(await getJson(src.url)));
      if (v > 1000 && v < 20000) return Math.round(v); // descarta respuestas absurdas
    } catch { /* prueba el siguiente */ }
  }
  return null;
}

export const isAuto = s => s.settings.usdAuto !== false;
export const isStale = s => isAuto(s) && (!s.settings.usdUpdatedAt || Date.now() - s.settings.usdUpdatedAt > SIX_HOURS);
