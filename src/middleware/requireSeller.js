// src/middleware/requireSeller.js
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET_SELLER || "seller_secret_dev";

export default function requireSeller(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer "))
    return res.status(401).json({ message: "No autenticado" });
  try {
    req.seller = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Token inválido o expirado" });
  }
}
