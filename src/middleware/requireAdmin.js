export default function requireAdmin(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers["x-admin-secret"] !== secret) {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
}
