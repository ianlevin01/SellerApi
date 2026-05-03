import pkg from "pg";
import { transporter } from "../config/mailer.js";
import config from "../config/db-config.js";
import pool from "../database/db.js";

const { Client } = pkg;

export function startStockListener() {
  async function connect() {
    const client = new Client({ ...config, ssl: { rejectUnauthorized: false } });

    client.on("error", (err) => {
      console.error("[stock-listener] pg client error:", err.message);
      client.end().catch(() => {});
      setTimeout(connect, 5000);
    });

    try {
      await client.connect();
      await client.query("LISTEN stock_alert");
      console.log("[stock-listener] listening for stock_alert notifications");

      client.on("notification", async (msg) => {
        try {
          const { product_id, available_stock } = JSON.parse(msg.payload);
          await handleAlert(product_id, available_stock);
        } catch (e) {
          console.error("[stock-listener] notification parse error:", e);
        }
      });
    } catch (err) {
      console.error("[stock-listener] connect failed:", err.message);
      setTimeout(connect, 5000);
    }
  }

  connect();
}

async function handleAlert(productId, availableStock) {
  const { rows } = await pool.query(
    `SELECT p.name, p.code,
            s.id AS seller_id, s.email, s.name AS seller_name
     FROM products p
     JOIN seller_products sp ON sp.product_id = p.id
     JOIN sellers s ON s.id = sp.seller_id
     WHERE p.id = $1 AND s.active = true`,
    [productId]
  );

  if (!rows.length) return;

  const productName = rows[0].name;
  const productCode = rows[0].code || productId;

  for (const seller of rows) {
    try {
      await transporter.sendMail({
        from: `"Ventaz" <${process.env.SMTP_USER}>`,
        to: seller.email,
        subject: `Stock bajo: ${productName}`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
            <h2 style="color:#ef4444">Stock bajo en tu tienda</h2>
            <p>Hola <strong>${seller.seller_name}</strong>,</p>
            <p>El producto <strong>${productName}</strong> (código: ${productCode})
               tiene <strong>${availableStock} unidades disponibles</strong> —
               por debajo del mínimo de 10.</p>
            <p>Este producto ya <strong>no es visible</strong> para tus clientes
               hasta que el stock se reponga.</p>
            <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
            <p style="color:#999;font-size:13px">
              Ventaz &middot; <a href="https://ventaz.com.ar">ventaz.com.ar</a>
            </p>
          </div>
        `,
      });
      console.log(`[stock-listener] email enviado a ${seller.email} — producto ${productCode}`);
    } catch (e) {
      console.error(`[stock-listener] email error para ${seller.email}:`, e.message);
    }
  }
}
