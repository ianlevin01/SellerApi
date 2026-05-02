import bcrypt from "bcrypt";
import jwt    from "jsonwebtoken";
import * as repo from "./adminAuthRepository.js";

const SECRET = process.env.JWT_SECRET_ADMIN || "admin_secret_dev";

export async function login(email, password) {
  if (!email || !password)
    throw { status: 400, message: "Email y contraseña requeridos" };

  const admin = await repo.findAdminByEmail(email);
  if (!admin) throw { status: 401, message: "Credenciales inválidas" };

  const ok = await bcrypt.compare(password, admin.password_hash);
  if (!ok) throw { status: 401, message: "Credenciales inválidas" };

  const token = jwt.sign({ id: admin.id, email: admin.email, name: admin.name }, SECRET, { expiresIn: "12h" });
  return { token, admin: { id: admin.id, email: admin.email, name: admin.name } };
}

export async function me(adminId) {
  const admin = await repo.findAdminById(adminId);
  if (!admin) throw { status: 404, message: "Admin no encontrado" };
  return admin;
}
