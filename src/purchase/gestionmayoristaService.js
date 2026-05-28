/**
 * Integración con gestionmayorista.online
 * Crea un Presupuesto en el sistema externo cada vez que se confirma un pago MP.
 */

const BASE_URL     = process.env.GESTION_MAYORISTA_URL          || "https://gestionmayorista.online";
const EMAIL        = process.env.GESTION_MAYORISTA_EMAIL        || "ian@gmail.com";
const PASSWORD     = process.env.GESTION_MAYORISTA_PASSWORD     || "IAN";
const CUSTOMER_ID  = process.env.GESTION_MAYORISTA_CUSTOMER_ID  || "90fd82cb-ffc2-40bf-8c35-50ae7df8dff2";
const WAREHOUSE_ID = process.env.GESTION_MAYORISTA_WAREHOUSE_ID || "f55ed3ed-7466-4b97-9ab6-4bbbae53d298";
const VENDEDOR     = process.env.GESTION_MAYORISTA_VENDEDOR     || "IAN";

// ── Token cache ──────────────────────────────────────────────────────────────
let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[gestionmayorista] login failed ${res.status}: ${text}`);
  }

  const data = await res.json();
  cachedToken = data.token ?? data.access_token ?? null;
  if (!cachedToken) throw new Error("[gestionmayorista] login OK pero no se recibió token");

  // Cachear 23 horas (la mayoría de los JWT duran 24h)
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
  return cachedToken;
}

// ── crearPresupuesto ─────────────────────────────────────────────────────────

/**
 * @param {Array<{ product_id: string, quantity: number, unit_price: number }>} items
 * @returns {Promise<object>} respuesta 201 con el comprobante creado
 */
export async function crearPresupuesto(items) {
  if (!items?.length) {
    throw new Error("[gestionmayorista] no hay ítems para crear el presupuesto");
  }

  const token = await getToken();

  const body = {
    tipo:           "Presupuesto",
    customer_id:    CUSTOMER_ID,
    payment_method: "Cta Cte",
    warehouse_id:   WAREHOUSE_ID,
    vendedor:       VENDEDOR,
    divisa:         "ARS",
    items: items.map(i => ({
      product_id: i.product_id,
      quantity:   i.quantity,
      unit_price: Math.round(Number(i.unit_price)),
    })),
  };

  const res = await fetch(`${BASE_URL}/api/comprobantes`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  // Token expirado → invalidar cache para que el próximo intento haga re-login
  if (res.status === 401) {
    cachedToken = null;
    tokenExpiry = 0;
    throw new Error("[gestionmayorista] 401 — token expirado, se reiniciará en el próximo intento");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[gestionmayorista] crearPresupuesto failed ${res.status}: ${text}`);
  }

  return await res.json();
}
