// MiCorreo (Correo Argentino) API wrapper
// Env vars required:
//   MICORREO_BASE_URL      — e.g. https://api.correoargentino.com.ar/micorreo/v1
//   MICORREO_USER          — username for Basic auth
//   MICORREO_PASS          — password for Basic auth
//   MICORREO_CUSTOMER_ID   — cliente ID for import endpoint
//   MICORREO_ORIGIN_CP     — origin postal code (seller's location), default "1000"
//   MICORREO_WEIGHT_GRAMS  — default shipment weight in grams, default "500"

const BASE        = process.env.MICORREO_BASE_URL    || "https://api.correoargentino.com.ar/micorreo/v1";
const ORIGIN_CP   = process.env.MICORREO_ORIGIN_CP   || "1000";
const DEF_WEIGHT  = Number(process.env.MICORREO_WEIGHT_GRAMS || "500");

let _token       = null;
let _tokenExpiry = 0;

function isConfigured() {
  return !!(process.env.MICORREO_USER && process.env.MICORREO_PASS);
}

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const creds = Buffer.from(
    `${process.env.MICORREO_USER}:${process.env.MICORREO_PASS}`
  ).toString("base64");

  const resp = await fetch(`${BASE}/token`, {
    method:  "POST",
    headers: { Authorization: `Basic ${creds}` },
  });

  if (!resp.ok) throw new Error(`MiCorreo auth failed: ${resp.status}`);
  const data = await resp.json();

  _token       = data.access_token;
  // Invalidate 60 s before actual expiry
  _tokenExpiry = Date.now() + ((data.expires_in || 3600) - 60) * 1000;
  return _token;
}

// Returns { available: boolean, rates: [...] }
// Each rate: { code, name, price, delivery_days, home_delivery, branch_pickup }
export async function getRates(cpDestino, weightGrams = DEF_WEIGHT) {
  if (!isConfigured()) return { available: false, rates: [] };

  try {
    const token = await getToken();
    const url   = `${BASE}/rates?cpOrigen=${ORIGIN_CP}&cpDestino=${cpDestino}&peso=${weightGrams}`;
    const resp  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    if (!resp.ok) {
      console.warn("[MiCorreo] getRates non-OK:", resp.status);
      return { available: false, rates: [] };
    }

    const data  = await resp.json();
    const raw   = Array.isArray(data) ? data : (data.rates || data.servicios || []);

    // NOTE: verify exact field names against your PDF documentation
    const rates = raw.map(r => ({
      code:          r.codigo      || r.code        || r.servicio   || "",
      name:          r.descripcion || r.name        || r.nombre     || "",
      price:         Number(r.precio || r.price || r.importe || r.costo || 0),
      delivery_days: r.plazo       || r.dias         || r.diasHabiles || null,
      home_delivery: r.domicilio   !== false && r.tipo !== "sucursal",
      branch_pickup: r.sucursal    !== false && r.tipo !== "domicilio",
    })).filter(r => r.price > 0 || r.code);

    return { available: true, rates };
  } catch (err) {
    console.error("[MiCorreo] getRates error:", err.message);
    return { available: false, rates: [] };
  }
}

// Returns array of agency objects: { id, name, address, city, province, cp }
export async function getAgencies(province) {
  if (!isConfigured()) return [];

  try {
    const token = await getToken();
    const url   = `${BASE}/agencies?provincia=${encodeURIComponent(province)}`;
    const resp  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    if (!resp.ok) {
      console.warn("[MiCorreo] getAgencies non-OK:", resp.status);
      return [];
    }

    const data = await resp.json();
    const raw  = Array.isArray(data) ? data : (data.agencies || data.sucursales || []);

    // NOTE: verify exact field names against your PDF documentation
    return raw.map(a => ({
      id:       String(a.id       || a.codigo      || a.sucursalId || ""),
      name:     a.nombre   || a.name        || a.descripcion || "",
      address:  a.direccion || a.address    || a.calle       || "",
      city:     a.localidad || a.city       || a.ciudad      || "",
      province: a.provincia || a.province   || province,
      cp:       a.cp        || a.codigoPostal || "",
    }));
  } catch (err) {
    console.error("[MiCorreo] getAgencies error:", err.message);
    return [];
  }
}

// Call after order is created; returns { tracking_code } or null on failure.
// Failure is logged but must never break the order flow.
export async function importShipment({ orderId, orderNumero, customer, shipping, total }) {
  if (!isConfigured()) return null;

  try {
    const token      = await getToken();
    const customerId = process.env.MICORREO_CUSTOMER_ID;

    // NOTE: verify exact body structure against your PDF documentation
    const body = {
      clienteId:  customerId,
      referencia: String(orderNumero || orderId),
      servicio:   shipping.service_code,
      destinatario: {
        nombre:    `${customer.firstName || ""} ${customer.lastName || customer.name || ""}`.trim(),
        email:     customer.email    || "",
        telefono:  customer.phone    || "",
        documento: customer.docNumber || "",
      },
      destino: shipping.type === "home" ? {
        tipo:      "domicilio",
        calle:     shipping.street        || "",
        numero:    shipping.street_number || "",
        piso:      shipping.floor_apt     || "",
        ciudad:    shipping.city          || "",
        provincia: shipping.province      || "",
        cp:        shipping.postal_code   || "",
      } : {
        tipo:       "sucursal",
        sucursalId: shipping.branch_id    || "",
        cp:         shipping.postal_code  || "",
      },
      bultos: [{ peso: DEF_WEIGHT, alto: 10, ancho: 20, largo: 30 }],
      valorDeclarado: Math.round(total),
    };

    const resp = await fetch(`${BASE}/shipping/import`, {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      console.warn("[MiCorreo] importShipment non-OK:", resp.status, await resp.text());
      return null;
    }

    const data = await resp.json();
    // NOTE: verify exact response field for tracking code against your PDF
    const tracking_code = data.codigoEnvio || data.tracking_code || data.codigo || data.id || null;
    return { tracking_code };
  } catch (err) {
    console.error("[MiCorreo] importShipment error:", err.message);
    return null;
  }
}
