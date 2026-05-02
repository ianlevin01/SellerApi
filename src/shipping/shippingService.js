const BASE       = process.env.MICORREO_BASE_URL  || "https://api.correoargentino.com.ar/micorreo/v1";
const ORIGIN_CP  = process.env.MICORREO_ORIGIN_CP || "1000";
const DEF_WEIGHT = Number(process.env.MICORREO_WEIGHT_GRAMS || "500");

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

  // API returns { token: "...", expires: "2022-04-26 21:16:20" }
  _token = data.token;

  // Parse expiry — cache 2 min before real expiry
  const expiresAt = data.expires ? new Date(data.expires).getTime() : Date.now() + 3600 * 1000;
  _tokenExpiry    = expiresAt - 2 * 60 * 1000;

  return _token;
}

// Returns { available: boolean, rates: [...] }
export async function getRates(cpDestino, weightGrams = DEF_WEIGHT) {
  if (!isConfigured()) return { available: false, rates: [] };

  try {
    const token      = await getToken();
    const customerId = process.env.MICORREO_CUSTOMER_ID;

    const ratesBody = {
      customerId:            String(customerId).padStart(10, "0"),
      postalCodeOrigin:      ORIGIN_CP,
      postalCodeDestination: cpDestino,
      dimensions: {
        weight: weightGrams,
        height: 10,
        width:  20,
        length: 30,
      },
    };

    // /rates is POST with JSON body per API docs
    const resp = await fetch(`${BASE}/rates`, {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(ratesBody),
    });

    if (!resp.ok) {
      console.warn("[MiCorreo] getRates non-OK:", resp.status, await resp.text());
      return { available: false, rates: [] };
    }

    const data = await resp.json();
    // Response: { rates: [{ deliveredType, productType, productName, price, deliveryTimeMin, deliveryTimeMax }] }
    const raw  = Array.isArray(data) ? data : (data.rates || []);

    const rates = raw.map(r => ({
      code:          r.productType    || "",
      name:          r.productName    || "",
      price:         Number(r.price   || 0),
      delivery_days: r.deliveryTimeMax || r.deliveryTimeMin || null,
      home_delivery: r.deliveredType  === "D",
      branch_pickup: r.deliveredType  === "S",
    })).filter(r => r.price > 0);

    return { available: true, rates };
  } catch (err) {
    console.error("[MiCorreo] getRates error:", err.message);
    return { available: false, rates: [] };
  }
}

// Maps 4-digit Argentine postal code to province code
function cpToProvinceCode(cp) {
  const n = parseInt(cp, 10);
  if (isNaN(n)) return null;
  if (n >= 1000 && n <= 1499) return "C"; // CABA
  if (n >= 1500 && n <= 1999) return "B"; // GBA
  if (n >= 6000 && n <= 6999) return "B"; // Bs As interior
  if (n >= 7000 && n <= 7999) return "B"; // Bs As sur
  if (n >= 2000 && n <= 2799) return "S"; // Santa Fe
  if (n >= 3000 && n <= 3099) return "S"; // Santa Fe
  if (n >= 2800 && n <= 2999) return "E"; // Entre Ríos
  if (n >= 3100 && n <= 3299) return "E"; // Entre Ríos
  if (n >= 3300 && n <= 3499) return "W"; // Corrientes
  if (n >= 3600 && n <= 3649) return "N"; // Misiones
  if (n >= 3500 && n <= 3799) return "H"; // Chaco
  if (n >= 3800 && n <= 3999) return "G"; // Santiago del Estero
  if (n >= 4000 && n <= 4299) return "T"; // Tucumán
  if (n >= 4300 && n <= 4499) return "G"; // Santiago del Estero
  if (n >= 4500 && n <= 4699) return "A"; // Salta
  if (n >= 4700 && n <= 4799) return "K"; // Catamarca
  if (n >= 4800 && n <= 4999) return "Y"; // Jujuy
  if (n >= 5000 && n <= 5599) return "X"; // Córdoba
  if (n >= 5400 && n <= 5599) return "J"; // San Juan
  if (n >= 5600 && n <= 5799) return "M"; // Mendoza
  if (n >= 5800 && n <= 5899) return "D"; // San Luis
  if (n >= 5300 && n <= 5399) return "F"; // La Rioja
  if (n >= 6400 && n <= 6499) return "L"; // La Pampa
  if (n >= 6800 && n <= 6999) return "L"; // La Pampa
  if (n >= 8000 && n <= 8299) return "Q"; // Neuquén
  if (n >= 8500 && n <= 8799) return "Q"; // Neuquén
  if (n >= 8300 && n <= 8499) return "R"; // Río Negro
  if (n >= 8800 && n <= 8999) return "R"; // Río Negro
  if (n >= 9000 && n <= 9199) return "U"; // Chubut
  if (n >= 9200 && n <= 9399) return "Z"; // Santa Cruz
  if (n >= 9400 && n <= 9499) return "V"; // Tierra del Fuego
  if (n >= 3400 && n <= 3599) return "P"; // Formosa
  return null;
}

export { cpToProvinceCode };

const PROVINCE_CODES = {
  "Buenos Aires":                      "B",
  "Ciudad Autónoma de Buenos Aires":   "C",
  "Catamarca":                         "K",
  "Chaco":                             "H",
  "Chubut":                            "U",
  "Córdoba":                           "X",
  "Corrientes":                        "W",
  "Entre Ríos":                        "E",
  "Formosa":                           "P",
  "Jujuy":                             "Y",
  "La Pampa":                          "L",
  "La Rioja":                          "F",
  "Mendoza":                           "M",
  "Misiones":                          "N",
  "Neuquén":                           "Q",
  "Río Negro":                         "R",
  "Salta":                             "A",
  "San Juan":                          "J",
  "San Luis":                          "D",
  "Santa Cruz":                        "Z",
  "Santa Fe":                          "S",
  "Santiago del Estero":               "G",
  "Tierra del Fuego":                  "V",
  "Tucumán":                           "T",
};

// Returns array of agencies: { id, name, address, city, province, cp }
// provinceOrCp can be a 4-digit postal code or a province name/code
export async function getAgencies(provinceOrCp) {
  if (!isConfigured()) return [];

  try {
    const token      = await getToken();
    const customerId = process.env.MICORREO_CUSTOMER_ID;

    const isCP = /^\d{1,4}$/.test(String(provinceOrCp).trim());
    const code  = isCP
      ? cpToProvinceCode(provinceOrCp)
      : (PROVINCE_CODES[provinceOrCp] || provinceOrCp);

    if (!code) return [];
    const paddedId   = String(customerId).padStart(10, "0");

    const url = `${BASE}/agencies?customerId=${encodeURIComponent(paddedId)}&provinceCode=${encodeURIComponent(code)}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    if (!resp.ok) {
      console.warn("[MiCorreo] getAgencies non-OK:", resp.status, await resp.text());
      return [];
    }

    const data = await resp.json();
    const raw  = Array.isArray(data) ? data : [];

    // Response: [{ code, name, location: { address: { streetName, city, postalCode } } }]
    return raw.map(a => ({
      id:       String(a.code || ""),
      name:     a.name || "",
      address:  a.location?.address?.streetName
                  ? `${a.location.address.streetName} ${a.location.address.streetNumber || ""}`.trim()
                  : "",
      city:     a.location?.address?.city     || "",
      province: a.location?.address?.provinceCode || code,
      cp:       a.location?.address?.postalCode || "",
    }));
  } catch (err) {
    console.error("[MiCorreo] getAgencies error:", err.message);
    return [];
  }
}

// Called after order is created. Never throws — failure is logged only.
export async function importShipment({ orderId, orderNumero, customer, shipping, total }) {
  if (!isConfigured()) return null;

  try {
    const token      = await getToken();
    const customerId = process.env.MICORREO_CUSTOMER_ID;

    const isHome     = shipping.type !== "branch";
    const paddedId   = String(customerId).padStart(10, "0");
    const provCode   = PROVINCE_CODES[shipping.province] || shipping.province || "";

    const body = {
      customerId:  paddedId,
      extOrderId:  String(orderId),
      orderNumber: String(orderNumero || orderId),
      recipient: {
        name:      customer.name  || customer.customer_name || "",
        phone:     customer.phone || "",
        cellPhone: customer.phone || "",
        email:     customer.email || "",
      },
      shipping: {
        deliveryType: isHome ? "D" : "S",
        productType:  "CP",
        agency:       isHome ? null : (shipping.branch_id || null),
        address: isHome ? {
          streetName:   shipping.street        || "",
          streetNumber: shipping.street_number || "",
          floor:        shipping.floor_apt     || "",
          apartment:    "",
          city:         shipping.city          || "",
          provinceCode: provCode,
          postalCode:   shipping.postal_code   || "",
        } : {
          streetName:   "",
          streetNumber: "",
          city:         "",
          provinceCode: provCode,
          postalCode:   shipping.postal_code || "",
        },
        weight:        DEF_WEIGHT,
        declaredValue: Math.round(total || 0),
        height:        10,
        length:        30,
        width:         20,
      },
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

    const result       = await resp.json();
    const tracking_code = result.trackingNumber || result.codigo || result.id || null;
    return { tracking_code };
  } catch (err) {
    console.error("[MiCorreo] importShipment error:", err.message);
    return null;
  }
}
