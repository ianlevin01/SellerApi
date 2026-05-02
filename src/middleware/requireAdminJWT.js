import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET_ADMIN || "admin_secret_dev";

export default function requireAdminJWT(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Token requerido" });
  try {
    req.admin = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ message: "Token inválido o expirado" });
  }
}
