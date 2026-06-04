// src/middleware/requireSeller.js
import jwt from "jsonwebtoken";
import pool from "../database/db.js";

const JWT_SECRET = process.env.JWT_SECRET_SELLER;
if (!JWT_SECRET) throw new Error("JWT_SECRET_SELLER env var requerida");

// Throttle: actualizamos last_active_at como máximo cada 5 minutos por seller
const lastUpdateCache = new Map();

function updateLastActive(sellerId) {
  const now = Date.now();
  const last = lastUpdateCache.get(sellerId) || 0;
  if (now - last < 5 * 60 * 1000) return;
  lastUpdateCache.set(sellerId, now);
  pool.query("UPDATE sellers SET last_active_at = now() WHERE id = $1", [sellerId])
    .catch(() => {});
}

export default function requireSeller(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer "))
    return res.status(401).json({ message: "No autenticado" });
  try {
    req.seller = jwt.verify(header.slice(7), JWT_SECRET);
    updateLastActive(req.seller.id);
    next();
  } catch {
    return res.status(401).json({ message: "Token inválido o expirado" });
  }
}
