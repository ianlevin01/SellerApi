// src/email/campaignService.js
// Envíos automáticos diarios a vendedores según su estado de actividad.
// Se ejecuta a las 10:00 AM hora Argentina. Máximo 1 email por seller por día.

import pool         from "../database/db.js";
import { transporter } from "../config/mailer.js";

const FROM      = process.env.SMTP_FROM || "noreply@ventaz.online";
const PANEL_URL = process.env.SELLER_APP_URL || "https://ventaz.com.ar";
const BRAND     = "#4db81a";
const BRAND_D   = "#3a9a15";

// ─── Layout base (mismo estilo que buyerEmails) ──────────────────────────────

function layout(content, ctaText, ctaUrl) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Ventaz</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f8;padding:32px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,${BRAND} 0%,${BRAND_D} 100%);border-radius:16px 16px 0 0;padding:32px 36px;text-align:center">
            <p style="margin:0;font-size:26px;font-weight:800;color:#fff;letter-spacing:-0.5px">Ventaz</p>
            <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,.75)">ventaz.com.ar</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:#fff;padding:36px 36px 28px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb">
            ${content}

            <!-- CTA -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px">
              <tr>
                <td align="center">
                  <a href="${ctaUrl}"
                     style="display:inline-block;background:${BRAND};color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:15px 36px;border-radius:10px;letter-spacing:.01em">
                    ${ctaText}
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 16px 16px;padding:20px 36px;text-align:center">
            <p style="margin:0;font-size:12px;color:#9ca3af">Sos parte de la comunidad de vendedores de Ventaz.</p>
            <p style="margin:8px 0 0;font-size:11px;color:#d1d5db">© 2025 Ventaz · <a href="https://ventaz.com.ar" style="color:#9ca3af;text-decoration:none">ventaz.com.ar</a></p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function infoBox(emoji, title, body, bg = "#f0fdf4", border = "#bbf7d0", titleColor = "#166534", bodyColor = "#374151") {
  return `
    <div style="background:${bg};border:1px solid ${border};border-radius:12px;padding:18px 20px;margin:20px 0">
      <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:${titleColor}">${emoji} ${title}</p>
      <p style="margin:0;font-size:13px;color:${bodyColor};line-height:1.65">${body}</p>
    </div>`;
}

function bulletBox(emoji, title, items, bg = "#f0fdf4", border = "#bbf7d0", titleColor = "#166534") {
  const li = items.map(i => `<li style="padding:2px 0">${i}</li>`).join("");
  return `
    <div style="background:${bg};border:1px solid ${border};border-radius:12px;padding:18px 20px;margin:20px 0">
      <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:${titleColor}">${emoji} ${title}</p>
      <ul style="margin:0;padding-left:18px;font-size:13px;color:#374151;line-height:1.9">${li}</ul>
    </div>`;
}

// ─── Templates ───────────────────────────────────────────────────────────────

function tmpl_inactive7d(name) {
  const first = name?.split(" ")[0] || "ahí";
  return {
    subject: `¿Todo bien, ${first}? Tu tienda te espera`,
    html: layout(`
      <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827">Hola, ${first} 👋</h2>
      <p style="margin:0 0 14px;font-size:15px;color:#374151;line-height:1.7">
        Hace unos días que no te vemos por el panel. Tu tienda sigue activa y lista para recibir clientes.
      </p>
      ${bulletBox("💡", "¿Qué podés hacer hoy?", [
        "Subir fotos nuevas a tus productos",
        "Activar descuentos por cantidad para atraer más compradores",
        "Compartir el link de tu tienda por WhatsApp y redes sociales",
      ])}
      <p style="margin:0;font-size:14px;color:#6b7280">Entrá a tu panel y seguí vendiendo. Tu tienda te necesita.</p>
    `, "Ir a mi panel →", PANEL_URL),
  };
}

function tmpl_inactive15d(name) {
  const first = name?.split(" ")[0] || "ahí";
  return {
    subject: `Tu tienda te está esperando, ${first}`,
    html: layout(`
      <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827">Hace un tiempo que no entrás, ${first}</h2>
      <p style="margin:0 0 14px;font-size:15px;color:#374151;line-height:1.7">
        Tu tienda en Ventaz sigue activa, pero podrías estar perdiendo oportunidades de venta si no la actualizás.
      </p>
      ${infoBox("⚡", "Los vendedores activos venden más", "Los que entran al panel regularmente tienen hasta 3× más ventas. Actualizar precios y fotos hace toda la diferencia.", "#fffbeb", "#fde68a", "#92400e", "#78350f")}
      <p style="margin:0;font-size:14px;color:#6b7280">Tomá 5 minutos hoy y revisá cómo está tu tienda.</p>
    `, "Ver mi tienda →", `${PANEL_URL}/pages`),
  };
}

function tmpl_inactive30d(name) {
  const first = name?.split(" ")[0] || "ahí";
  return {
    subject: `¿Seguís vendiendo con Ventaz, ${first}?`,
    html: layout(`
      <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827">Extrañamos verte, ${first}</h2>
      <p style="margin:0 0 14px;font-size:15px;color:#374151;line-height:1.7">
        Hace un mes que no entrás a tu panel. Tu tienda sigue online, pero sin actualizaciones puede estar quedando desactualizada.
      </p>
      ${infoBox("🔔", "Tu tienda necesita atención", "Si querés seguir vendiendo, entrá y revisá que todo esté en orden. Si necesitás ayuda, nuestro equipo está disponible en el panel.", "#fef2f2", "#fecaca", "#991b1b", "#7f1d1d")}
      <p style="margin:0;font-size:14px;color:#6b7280">Volvé cuando quieras — tu cuenta sigue activa y tu tienda está esperándote.</p>
    `, "Volver al panel →", PANEL_URL),
  };
}

function tmpl_noStore(name) {
  const first = name?.split(" ")[0] || "ahí";
  return {
    subject: `Tu tienda online está a 2 minutos, ${first}`,
    html: layout(`
      <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827">Hola, ${first}! Todavía no creaste tu tienda</h2>
      <p style="margin:0 0 14px;font-size:15px;color:#374151;line-height:1.7">
        Te registraste en Ventaz pero todavía no diste el primer paso. Crear tu tienda online es muy fácil y rápido.
      </p>

      <!-- Steps -->
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:18px 20px;margin:20px 0">
        <p style="margin:0 0 14px;font-size:13px;font-weight:700;color:#166534">Cómo crear tu tienda en 3 pasos:</p>
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="width:28px;vertical-align:top;padding-top:2px">
              <div style="width:22px;height:22px;background:${BRAND};border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:800;color:#fff">1</div>
            </td>
            <td style="padding:0 0 10px 10px;font-size:13px;color:#374151">Entrá a <strong>Mis tiendas</strong> y hacé clic en <strong>Crear tienda</strong></td>
          </tr>
          <tr>
            <td style="width:28px;vertical-align:top;padding-top:2px">
              <div style="width:22px;height:22px;background:${BRAND};border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:800;color:#fff">2</div>
            </td>
            <td style="padding:0 0 10px 10px;font-size:13px;color:#374151">Elegí un nombre y personalizá los colores y diseño</td>
          </tr>
          <tr>
            <td style="width:28px;vertical-align:top;padding-top:2px">
              <div style="width:22px;height:22px;background:${BRAND};border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:800;color:#fff">3</div>
            </td>
            <td style="padding:0 0 0 10px;font-size:13px;color:#374151">Agregá productos y ¡listo para vender!</td>
          </tr>
        </table>
      </div>
      <p style="margin:0;font-size:14px;color:#6b7280">¡En menos de 10 minutos tenés tu tienda funcionando!</p>
    `, "Crear mi tienda →", `${PANEL_URL}/pages`),
  };
}

function tmpl_noProducts(name) {
  const first = name?.split(" ")[0] || "ahí";
  return {
    subject: `Tu tienda está vacía, ${first} — así la llenás hoy`,
    html: layout(`
      <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827">Hola, ${first}! Tu tienda está lista pero vacía</h2>
      <p style="margin:0 0 14px;font-size:15px;color:#374151;line-height:1.7">
        Creaste tu tienda — ¡eso es un gran primer paso! Ahora falta agregarle productos para que tus clientes puedan comprar.
      </p>
      ${infoBox("📦", "Tenemos cientos de productos listos", "En Ventaz encontrás productos de todas las categorías para agregar a tu tienda con un clic. Precios, fotos y descripción ya incluidos — solo elegís lo que querés vender.", "#eff6ff", "#bfdbfe", "#1e40af", "#1e3a8a")}
      <p style="margin:0;font-size:14px;color:#6b7280">Entrá al panel y elegí los productos que querés vender hoy.</p>
    `, "Agregar productos →", `${PANEL_URL}/dashboard`),
  };
}

function tmpl_trial_expiring(name, trialEndsAt) {
  const first = name?.split(" ")[0] || "ahí";
  const endDate = new Date(trialEndsAt);
  const dateStr = endDate.toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "long", day: "numeric", month: "long",
  });
  return {
    subject: `⏰ Tu prueba gratuita termina mañana, ${first}`,
    html: layout(`
      <!-- Urgency badge -->
      <div style="display:inline-flex;align-items:center;gap:10px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px 16px;margin-bottom:24px">
        <span style="font-size:20px">⏰</span>
        <span style="font-size:14px;font-weight:700;color:#dc2626">Tu prueba gratuita termina mañana</span>
      </div>

      <h2 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#111827">
        Hola, ${first} — te queda 1 día
      </h2>
      <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.7">
        Tu período de prueba gratuita <strong>vence el ${dateStr}</strong>. No pierdas el acceso a tu tienda ni a todas las funciones de Ventaz.
      </p>

      <!-- Countdown card -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
        <tr>
          <td style="background:linear-gradient(135deg,#dc2626 0%,#b91c1c 100%);border-radius:14px;padding:22px 28px;text-align:center">
            <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:rgba(255,255,255,.8);text-transform:uppercase;letter-spacing:.1em">Tiempo restante</p>
            <p style="margin:0;font-size:36px;font-weight:900;color:#fff;letter-spacing:-1px">1 día</p>
            <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,.7)">Vence el ${dateStr}</p>
          </td>
        </tr>
      </table>

      <!-- Benefits of upgrading -->
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:18px 20px;margin-bottom:20px">
        <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#166534">✅ ¿Qué mantenés al suscribirte?</p>
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr><td style="padding:3px 0;font-size:13px;color:#374151">✔ &nbsp;Tu tienda online activa y visible</td></tr>
          <tr><td style="padding:3px 0;font-size:13px;color:#374151">✔ &nbsp;Todos tus productos configurados</td></tr>
          <tr><td style="padding:3px 0;font-size:13px;color:#374151">✔ &nbsp;Tu historial de ventas y ganancias</td></tr>
          <tr><td style="padding:3px 0;font-size:13px;color:#374151">✔ &nbsp;Cobros vía MercadoPago y transferencias</td></tr>
        </table>
      </div>

      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;line-height:1.65">
        Sin suscripción, tu tienda quedará inactiva y tus clientes no podrán ver ni comprar tus productos.
        Elegí un plan y seguí vendiendo sin interrupciones.
      </p>
    `, "Ver planes y suscribirme →", `${PANEL_URL}/subscription`),
  };
}

function tmpl_noSales(name) {
  const first = name?.split(" ")[0] || "ahí";
  return {
    subject: `Tu tienda está lista, ${first} — ¿ya la compartiste?`,
    html: layout(`
      <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827">Hola, ${first}! Tu tienda tiene todo para vender</h2>
      <p style="margin:0 0 14px;font-size:15px;color:#374151;line-height:1.7">
        Tenés tu tienda con productos — ¡excelente! El próximo paso es que la gente la conozca. La clave está en compartirla.
      </p>
      ${bulletBox("💡", "Consejos para tu primera venta", [
        "Compartí el link de tu tienda por WhatsApp a tus contactos",
        "Publicalo en tu Instagram con el link en tu bio",
        "Avisale a amigos y familia que abriste tu tienda online",
        "Publicá en grupos de Facebook de tu zona",
      ], "#f5f3ff", "#ddd6fe", "#5b21b6")}
      <p style="margin:0;font-size:14px;color:#6b7280">Tu tienda está lista. La primera venta puede ser hoy.</p>
    `, "Ver mi tienda →", `${PANEL_URL}/pages`),
  };
}

function tmpl_firstSale(name) {
  const first = name?.split(" ")[0] || "ahí";
  return {
    subject: `🎉 ¡Vendiste! Tu primera venta en Ventaz, ${first}`,
    html: layout(`
      <div style="text-align:center;margin-bottom:20px">
        <span style="font-size:56px;line-height:1">🎉</span>
      </div>
      <h2 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#111827;text-align:center">¡Felicitaciones, ${first}!</h2>
      <p style="margin:0 0 14px;font-size:15px;color:#374151;line-height:1.7;text-align:center">
        Acabás de hacer tu <strong>primera venta con Ventaz</strong>. Este es un momento importante — bienvenido al mundo del comercio digital.
      </p>
      ${bulletBox("🚀", "¿Qué hacer ahora?", [
        "Confirmá el pedido y coordiná la entrega con tu cliente",
        "Tu ganancia se acredita automáticamente en tu saldo de Ventaz",
        "Seguí compartiendo tu tienda para conseguir más ventas",
        "Activá MercadoPago si todavía no lo hiciste para cobrar online",
      ])}
      <p style="margin:0;font-size:14px;color:#6b7280;text-align:center">El equipo de Ventaz está orgulloso de vos. ¡Seguí así!</p>
    `, "Ver mi pedido →", `${PANEL_URL}/orders`),
  };
}

function tmpl_week1(name) {
  const first = name?.split(" ")[0] || "ahí";
  return {
    subject: `Una semana con Ventaz, ${first} — ¿cómo va todo?`,
    html: layout(`
      <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827">Hola, ${first}! Ya pasó tu primera semana</h2>
      <p style="margin:0 0 14px;font-size:15px;color:#374151;line-height:1.7">
        Hace 7 días te uniste a Ventaz. Queremos asegurarnos de que todo esté yendo bien y que tengas lo que necesitás para vender.
      </p>

      <!-- Checklist -->
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:18px 20px;margin:20px 0">
        <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#166534">✅ Checklist de primera semana</p>
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr><td style="padding:4px 0;font-size:13px;color:#374151">☐ &nbsp;Creé mi tienda con nombre y diseño personalizado</td></tr>
          <tr><td style="padding:4px 0;font-size:13px;color:#374151">☐ &nbsp;Agregué productos que quiero vender</td></tr>
          <tr><td style="padding:4px 0;font-size:13px;color:#374151">☐ &nbsp;Configuré MercadoPago para cobrar online</td></tr>
          <tr><td style="padding:4px 0;font-size:13px;color:#374151">☐ &nbsp;Compartí el link de mi tienda con mis clientes</td></tr>
        </table>
      </div>

      <p style="margin:0;font-size:14px;color:#6b7280">
        Si necesitás ayuda con algo, escribinos desde el panel en <strong>Contacto</strong>. Estamos para ayudarte.
      </p>
    `, "Ir al panel →", PANEL_URL),
  };
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

async function getSellers() {
  const { rows } = await pool.query(`
    SELECT
      s.id,
      s.name,
      s.email,
      s.last_active_at,
      s.created_at,
      s.plan_status,
      s.trial_ends_at,
      (SELECT COUNT(*)
       FROM seller_pages sp
       WHERE sp.seller_id = s.id
      )::int AS store_count,
      (SELECT COUNT(DISTINCT spr.product_id)
       FROM seller_products spr
       JOIN seller_pages sp ON sp.id = spr.page_id
       WHERE sp.seller_id = s.id
      )::int AS product_count,
      (SELECT COUNT(*)
       FROM web_orders wo
       WHERE wo.seller_id = s.id AND wo.color = 'paid'
      )::int AS paid_orders
    FROM sellers s
    WHERE s.active = true
      AND s.email IS NOT NULL
      AND s.email != ''
    ORDER BY s.created_at DESC
  `);
  return rows;
}

async function emailSentToday(sellerId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM seller_email_logs
     WHERE seller_id = $1 AND sent_at > NOW() - INTERVAL '20 hours'
     LIMIT 1`,
    [sellerId]
  );
  return rows.length > 0;
}

async function typeSentEver(sellerId, type) {
  const { rows } = await pool.query(
    `SELECT 1 FROM seller_email_logs WHERE seller_id = $1 AND email_type = $2 LIMIT 1`,
    [sellerId, type]
  );
  return rows.length > 0;
}

async function typeSentSinceLogin(sellerId, type, sinceDate) {
  const { rows } = await pool.query(
    `SELECT 1 FROM seller_email_logs
     WHERE seller_id = $1 AND email_type = $2 AND sent_at > $3
     LIMIT 1`,
    [sellerId, type, sinceDate]
  );
  return rows.length > 0;
}

async function logEmail(sellerId, type) {
  await pool.query(
    `INSERT INTO seller_email_logs (seller_id, email_type) VALUES ($1, $2)`,
    [sellerId, type]
  );
}

// ─── Priority logic ───────────────────────────────────────────────────────────
// Returns the email type to send, or null if nothing should be sent.
// Priority: first_sale > inactive_30d > inactive_15d > inactive_7d
//           > no_store > no_products > no_sales > week_1

async function pickEmail(seller) {
  const now           = new Date();
  const lastActive    = seller.last_active_at
    ? new Date(seller.last_active_at)
    : new Date(seller.created_at);
  const daysSinceActive   = (now - lastActive)                  / 86400000;
  const daysSinceRegister = (now - new Date(seller.created_at)) / 86400000;
  const stores   = seller.store_count;
  const products = seller.product_count;
  const orders   = seller.paid_orders;

  // 0. Trial por vencer (máxima prioridad — ventana de 36h para no perdérselo)
  if (seller.plan_status === "trial" && seller.trial_ends_at) {
    const hoursLeft = (new Date(seller.trial_ends_at) - now) / 3600000;
    if (hoursLeft > 0 && hoursLeft <= 36 && !(await typeSentEver(seller.id, "trial_expiring_1d"))) {
      return "trial_expiring_1d";
    }
  }

  // 1. Primera venta (solo se manda una vez)
  if (orders > 0 && !(await typeSentEver(seller.id, "first_sale"))) {
    return "first_sale";
  }

  // 2-4. Inactividad (una vez por sesión de inactividad, reinicia al volver a loguearse)
  if (daysSinceActive >= 30 && !(await typeSentSinceLogin(seller.id, "inactive_30d", lastActive))) {
    return "inactive_30d";
  }
  if (daysSinceActive >= 15 && daysSinceActive < 30 && !(await typeSentSinceLogin(seller.id, "inactive_15d", lastActive))) {
    return "inactive_15d";
  }
  if (daysSinceActive >= 7 && daysSinceActive < 15 && !(await typeSentSinceLogin(seller.id, "inactive_7d", lastActive))) {
    return "inactive_7d";
  }

  // Onboarding/lifecycle solo si el vendedor estuvo activo en los últimos 7 días
  if (daysSinceActive >= 7) return null;

  // 5. Sin tienda después de 3 días
  if (daysSinceRegister >= 3 && stores === 0 && !(await typeSentEver(seller.id, "no_store"))) {
    return "no_store";
  }

  // 6. Tiene tienda pero sin productos después de 3 días
  if (daysSinceRegister >= 3 && stores > 0 && products === 0 && !(await typeSentEver(seller.id, "no_products"))) {
    return "no_products";
  }

  // 7. Tiene productos pero sin ventas después de 10 días
  if (daysSinceRegister >= 10 && products > 0 && orders === 0 && !(await typeSentEver(seller.id, "no_sales"))) {
    return "no_sales";
  }

  // 8. Primera semana (ventana de 2 días para no perder la fecha exacta)
  if (daysSinceRegister >= 7 && daysSinceRegister < 9 && !(await typeSentEver(seller.id, "week_1"))) {
    return "week_1";
  }

  return null;
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export async function runCampaigns() {
  console.log("[campaign] Iniciando envíos automáticos...");
  const sellers = await getSellers();
  let sent = 0;
  let skipped = 0;

  const TEMPLATES = {
    trial_expiring_1d: (name, seller) => tmpl_trial_expiring(name, seller.trial_ends_at),
    inactive_7d:  tmpl_inactive7d,
    inactive_15d: tmpl_inactive15d,
    inactive_30d: tmpl_inactive30d,
    no_store:     tmpl_noStore,
    no_products:  tmpl_noProducts,
    no_sales:     tmpl_noSales,
    first_sale:   tmpl_firstSale,
    week_1:       tmpl_week1,
  };

  for (const seller of sellers) {
    try {
      if (await emailSentToday(seller.id)) { skipped++; continue; }

      const type = await pickEmail(seller);
      if (!type) { skipped++; continue; }

      const { subject, html } = TEMPLATES[type](seller.name, seller);
      await transporter.sendMail({ from: FROM, to: seller.email, subject, html });
      await logEmail(seller.id, type);
      console.log(`[campaign] ${type} → ${seller.email}`);
      sent++;

      await new Promise(r => setTimeout(r, 300)); // anti-throttle
    } catch (err) {
      console.error(`[campaign] Error con ${seller.email}:`, err.message);
    }
  }

  console.log(`[campaign] Completado: ${sent} enviados, ${skipped} sin acción.`);
}

// ─── Scheduler: 10:00 AM Argentina (UTC-3, sin DST) ─────────────────────────

export function startCampaignScheduler() {
  function msUntilNext10am() {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(13, 0, 0, 0); // 10am ART = 13:00 UTC
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next - now;
  }

  function schedule() {
    const delay = msUntilNext10am();
    const hrs   = Math.round(delay / 3600000 * 10) / 10;
    console.log(`[campaign] Próxima ejecución en ${hrs}h (10:00 AM Argentina)`);

    setTimeout(async () => {
      try { await runCampaigns(); } catch (err) {
        console.error("[campaign] Error en ejecución:", err.message);
      }
      schedule();
    }, delay);
  }

  schedule();
}
