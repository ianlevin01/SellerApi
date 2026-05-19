import { transporter } from "../config/mailer.js";
import pool from "../database/db.js";

const FROM    = process.env.SMTP_FROM || "noreply@ventaz.online";
const BRAND   = "#4db81a";
const BRAND_D = "#3a9a15";

function fmt(n) {
  return `$${Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
}

function baseLayout(content) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
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
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 16px 16px;padding:20px 36px;text-align:center">
            <p style="margin:0;font-size:12px;color:#9ca3af">
              Si tenés alguna consulta sobre tu pedido, contactanos en
              <a href="mailto:somosventaz@gmail.com" style="color:${BRAND};text-decoration:none">somosventaz@gmail.com</a>
            </p>
            <p style="margin:8px 0 0;font-size:11px;color:#d1d5db">© 2025 Ventaz — Todos los derechos reservados</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function itemsTable(items) {
  const rows = items.map(i => `
    <tr>
      <td style="padding:10px 12px;font-size:14px;color:#374151;border-bottom:1px solid #f3f4f6">${i.name}</td>
      <td style="padding:10px 12px;font-size:14px;color:#374151;border-bottom:1px solid #f3f4f6;text-align:center;white-space:nowrap">× ${i.quantity}</td>
      <td style="padding:10px 12px;font-size:14px;color:#111827;font-weight:600;border-bottom:1px solid #f3f4f6;text-align:right;white-space:nowrap">${fmt(i.unit_price ?? i.unit_price_final)}</td>
    </tr>`).join("");

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin:20px 0">
      <thead>
        <tr style="background:#f9fafb">
          <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#6b7280;text-align:left;text-transform:uppercase;letter-spacing:.5px">Producto</th>
          <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#6b7280;text-align:center;text-transform:uppercase;letter-spacing:.5px">Cant.</th>
          <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#6b7280;text-align:right;text-transform:uppercase;letter-spacing:.5px">Precio</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function totalBlock(total, shippingAmount = 0) {
  const subtotal    = total - shippingAmount;
  const hasShipping = shippingAmount > 0;
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px">
      ${hasShipping ? `
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#6b7280">Subtotal</td>
        <td style="padding:4px 0;font-size:13px;color:#6b7280;text-align:right">${fmt(subtotal)}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#6b7280">Envío</td>
        <td style="padding:4px 0;font-size:13px;color:#6b7280;text-align:right">${fmt(shippingAmount)}</td>
      </tr>
      <tr><td colspan="2" style="padding:4px 0"><hr style="border:none;border-top:1px solid #e5e7eb;margin:6px 0"/></td></tr>
      ` : ""}
      <tr>
        <td style="padding:6px 0;font-size:16px;font-weight:700;color:#111827">Total</td>
        <td style="padding:6px 0;font-size:18px;font-weight:800;color:${BRAND};text-align:right">${fmt(total)}</td>
      </tr>
    </table>`;
}

// ── Email 1: pedido recibido → comprador (al crear el checkout MP) ─────────

export async function sendOrderReceived({ customer, order, items, shippingAmount = 0 }) {
  if (!customer?.email) return;
  try {
    const name = customer.name?.split(" ")[0] || "ahí";
    const html = baseLayout(`
      <div style="display:inline-flex;align-items:center;gap:10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 16px;margin-bottom:24px">
        <span style="font-size:20px">✅</span>
        <span style="font-size:14px;font-weight:600;color:#15803d">¡Pedido recibido!</span>
      </div>

      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827">Hola, ${name} 👋</h2>
      <p style="margin:0 0 6px;font-size:15px;color:#374151">
        Recibimos tu pedido <strong style="color:${BRAND}">#${order.numero}</strong>.
        Ahora completá el pago para confirmarlo.
      </p>

      ${itemsTable(items)}
      ${totalBlock(order.total ?? (items.reduce((s,i) => s + (i.unit_price ?? i.unit_price_final) * i.quantity, 0) + shippingAmount), shippingAmount)}

      <div style="margin-top:24px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:16px 18px">
        <p style="margin:0;font-size:13px;color:#5b21b6;font-weight:600">¿Qué sigue?</p>
        <p style="margin:6px 0 0;font-size:13px;color:#6b7280;line-height:1.5">
          Una vez confirmado tu pago, te enviaremos otro mail con la confirmación y el vendedor coordinará la entrega.
        </p>
      </div>
    `);

    await transporter.sendMail({
      from: FROM,
      to:      customer.email,
      subject: `✅ Pedido #${order.numero} recibido — Ventaz`,
      html,
    });
  } catch (err) {
    console.error("[email] sendOrderReceived error:", err.message);
  }
}

// ── Email 2: pago confirmado → comprador (cuando MP confirma) ─────────────

export async function sendPaymentConfirmed(orderId) {
  try {
    const { rows } = await pool.query(
      `SELECT wo.id, wo.numero, wo.customer_name, wo.customer_email, wo.total, wo.seller_id,
              COALESCE(wo.shipping_amount, 0) AS shipping_amount,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'name',       woi.name,
                  'quantity',   woi.quantity,
                  'unit_price', woi.unit_price
                )) FROM web_order_items woi WHERE woi.web_order_id = wo.id),
                '[]'
              ) AS items
       FROM web_orders wo WHERE wo.id = $1`,
      [orderId]
    );

    const order = rows[0];
    if (!order) return;

    // Email al comprador
    if (order.customer_email) {
      const name = order.customer_name?.split(" ")[0] || "ahí";
      const html = baseLayout(`
        <div style="display:inline-flex;align-items:center;gap:10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px 16px;margin-bottom:24px">
          <span style="font-size:20px">💳</span>
          <span style="font-size:14px;font-weight:600;color:#1d4ed8">¡Pago confirmado!</span>
        </div>

        <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827">¡Gracias, ${name}!</h2>
        <p style="margin:0 0 6px;font-size:15px;color:#374151">
          Recibimos tu pago para el pedido <strong style="color:${BRAND}">#${order.numero}</strong>. 🎉
          El vendedor ya fue notificado y está preparando tu pedido.
        </p>

        ${itemsTable(order.items)}
        ${totalBlock(Number(order.total), Number(order.shipping_amount))}

        <div style="margin-top:24px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 18px">
          <p style="margin:0;font-size:13px;color:#15803d;font-weight:600">¿Qué sigue?</p>
          <p style="margin:6px 0 0;font-size:13px;color:#6b7280;line-height:1.5">
            El vendedor se comunicará con vos para coordinar la entrega o el retiro.
          </p>
        </div>
      `);

      await transporter.sendMail({
        from: FROM,
        to:      order.customer_email,
        subject: `💳 Pago confirmado — Pedido #${order.numero}`,
        html,
      });
    }

    // Email al vendedor (revendedor)
    if (order.seller_id) {
      const { rows: sellerRows } = await pool.query(
        `SELECT email, name FROM sellers WHERE id = $1`,
        [order.seller_id]
      );
      const seller = sellerRows[0];
      if (seller?.email) {
        const html = baseLayout(`
          <div style="display:inline-flex;align-items:center;gap:10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 16px;margin-bottom:24px">
            <span style="font-size:20px">🎉</span>
            <span style="font-size:14px;font-weight:600;color:#15803d">¡Pago confirmado!</span>
          </div>

          <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827">Hola${seller.name ? `, ${seller.name.split(" ")[0]}` : ""}! Tenés una nueva venta.</h2>
          <p style="margin:0 0 6px;font-size:15px;color:#374151">
            El pago del pedido <strong style="color:${BRAND}">#${order.numero}</strong> fue confirmado por MercadoPago.
            El comprador es <strong>${order.customer_name}</strong>.
          </p>

          ${itemsTable(order.items)}
          ${totalBlock(Number(order.total), Number(order.shipping_amount))}

          <div style="margin-top:24px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:16px 18px">
            <p style="margin:0;font-size:13px;color:#5b21b6;font-weight:600">Próximos pasos</p>
            <p style="margin:6px 0 0;font-size:13px;color:#6b7280;line-height:1.5">
              Coordiná la entrega con el comprador. Revisá tu panel en ventaz.com.ar para ver el detalle completo.
            </p>
          </div>
        `);

        await transporter.sendMail({
          from: FROM,
          to:      seller.email,
          subject: `🎉 Nueva venta confirmada — Pedido #${order.numero}`,
          html,
        });
      }
    }
  } catch (err) {
    console.error("[email] sendPaymentConfirmed error:", err.message);
  }
}

// ── Email 3: nueva venta → vendedor (al crear el checkout, antes del pago) ──

export async function sendSellerOrderPending({ sellerId, order, items, shippingAmount = 0 }) {
  if (!sellerId) return;
  try {
    const { rows } = await pool.query(
      `SELECT email, name FROM sellers WHERE id = $1`,
      [sellerId]
    );
    const seller = rows[0];
    if (!seller?.email) return;

    const html = baseLayout(`
      <div style="display:inline-flex;align-items:center;gap:10px;background:#fefce8;border:1px solid #fde68a;border-radius:10px;padding:12px 16px;margin-bottom:24px">
        <span style="font-size:20px">🛒</span>
        <span style="font-size:14px;font-weight:600;color:#92400e">Nuevo pedido iniciado</span>
      </div>

      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827">Hola${seller.name ? `, ${seller.name.split(" ")[0]}` : ""}!</h2>
      <p style="margin:0 0 6px;font-size:15px;color:#374151">
        Se inició el pedido <strong style="color:${BRAND}">#${order.numero}</strong>.
        El comprador está completando el pago. Te avisamos cuando se confirme.
      </p>

      ${itemsTable(items)}
      ${totalBlock(order.total ?? (items.reduce((s,i) => s + (i.unit_price ?? i.unit_price_final) * i.quantity, 0) + shippingAmount), shippingAmount)}
    `);

    await transporter.sendMail({
      from: FROM,
      to:      seller.email,
      subject: `🛒 Pedido #${order.numero} iniciado — esperando pago`,
      html,
    });
  } catch (err) {
    console.error("[email] sendSellerOrderPending error:", err.message);
  }
}
