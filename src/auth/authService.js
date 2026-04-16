// src/modules/auth/authService.js
import bcrypt     from "bcryptjs";
import jwt        from "jsonwebtoken";
import crypto     from "crypto";
import nodemailer from "nodemailer";
import twilio     from "twilio";
import * as authRepository from "./authRepository.js";

const twilioClient = process.env.TWILIO_ACCOUNT_SID
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

const JWT_SECRET = process.env.JWT_SECRET_SELLER || "seller_secret_dev";
const BASE_URL   = process.env.SELLER_APP_URL || "http://localhost:5173";

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

async function sendVerificationEmail(email, token) {
  const link = `${BASE_URL}/verify-email?token=${token}`;
  await transporter.sendMail({
    from:    process.env.SMTP_FROM || "noreply@tudominio.com",
    to:      email,
    subject: "Verificá tu cuenta de vendedor",
    html: `
      <h2>Bienvenido al portal de vendedores</h2>
      <p>Hacé clic en el siguiente link para verificar tu cuenta:</p>
      <a href="${link}" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">
        Verificar cuenta
      </a>
      <p style="color:#666;font-size:12px;margin-top:16px">Este link expira en 24 horas.</p>
    `,
  });
}

function buildSlug(name, id) {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) + "-" + id.slice(0, 6);
}

function signToken(seller) {
  return jwt.sign(
    { id: seller.id, email: seller.email, name: seller.name, slug: seller.slug },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

export async function register({ email, password, name, phone }) {
  if (!email || !password || !name)
    throw { status: 400, message: "Email, contraseña y nombre son requeridos" };
  if (password.length < 8)
    throw { status: 400, message: "La contraseña debe tener al menos 8 caracteres" };

  const normalizedEmail = email.toLowerCase();
  if (await authRepository.emailExists(normalizedEmail))
    throw { status: 409, message: "Ya existe una cuenta con ese email" };

  const password_hash = await bcrypt.hash(password, 12);
  const verify_token  = crypto.randomBytes(32).toString("hex");

  const seller = await authRepository.createSeller({
    email: normalizedEmail, password_hash, name, phone, verify_token,
  });

  const slug = buildSlug(name, seller.id);
  await authRepository.createSellerPage({ seller_id: seller.id, slug, store_name: name });
  await sendVerificationEmail(normalizedEmail, verify_token);

  return { email: seller.email };
}

export async function verifyEmail(token) {
  if (!token) throw { status: 400, message: "Token requerido" };
  const seller = await authRepository.verifySellerToken(token);
  if (!seller)  throw { status: 400, message: "Token inválido o ya usado" };
  return { message: "Cuenta verificada. Ya podés iniciar sesión." };
}

export async function login({ email, password }) {
  if (!email || !password)
    throw { status: 400, message: "Email y contraseña requeridos" };

  const seller = await authRepository.findSellerByEmail(email.toLowerCase());
  if (!seller)          throw { status: 401, message: "Email o contraseña incorrectos" };
  if (!seller.verified) throw { status: 403, message: "Verificá tu email antes de ingresar" };

  const valid = await bcrypt.compare(password, seller.password_hash);
  if (!valid) throw { status: 401, message: "Email o contraseña incorrectos" };

  const token = signToken(seller);
  return {
    token,
    seller: {
      id:         seller.id,
      email:      seller.email,
      name:       seller.name,
      slug:       seller.slug,
      store_name: seller.store_name,
      pct_markup: seller.pct_markup,
    },
  };
}

export async function getMe(sellerId) {
  const seller = await authRepository.findSellerById(sellerId);
  if (!seller) throw { status: 404, message: "No encontrado" };
  return seller;
}

export async function updateProfile(sellerId, data) {
  const seller = await authRepository.updateProfile(sellerId, data);
  if (!seller) throw { status: 404, message: "No encontrado" };
  return seller;
}

export async function requestOtp(sellerId) {
  const seller = await authRepository.findSellerById(sellerId);
  if (!seller) throw { status: 404, message: "No encontrado" };
  if (!seller.phone) throw { status: 400, message: "Guardá tu número de teléfono antes de verificarlo" };
  if (!twilioClient)  throw { status: 503, message: "El servicio de SMS no está configurado" };

  const otp       = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

  await authRepository.saveOtp(sellerId, otp, expiresAt);

  await twilioClient.messages.create({
    from: process.env.TWILIO_FROM_NUMBER,
    to:   seller.phone,
    body: `Tu código de verificación es: ${otp}. Válido por 10 minutos.`,
  });

  return { message: "Código enviado por SMS" };
}

export async function verifyOtp(sellerId, otp) {
  if (!otp) throw { status: 400, message: "Código requerido" };
  const valid = await authRepository.verifyOtp(sellerId, otp);
  if (!valid) throw { status: 400, message: "Código incorrecto o expirado" };
  return { message: "Teléfono verificado exitosamente" };
}
