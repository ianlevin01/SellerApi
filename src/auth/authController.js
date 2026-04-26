// src/modules/auth/authController.js
import * as authService from "./authService.js";

function handleError(res, err) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(err);
  return res.status(500).json({ message: "Error interno" });
}

export async function register(req, res) {
  try {
    const result = await authService.register(req.body);
    return res.status(201).json({
      message: "Cuenta creada. Revisá tu email para verificarla.",
      ...result,
    });
  } catch (err) { handleError(res, err); }
}

export async function verifyEmail(req, res) {
  try {
    const result = await authService.verifyEmail(req.query.token);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function login(req, res) {
  try {
    const result = await authService.login(req.body);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function getMe(req, res) {
  try {
    const result = await authService.getMe(req.seller.id);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function getProfile(req, res) {
  try {
    const result = await authService.getMe(req.seller.id);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function updateProfile(req, res) {
  try {
    const { name, phone, city, age, how_found_us } = req.body;
    const result = await authService.updateProfile(req.seller.id, { name, phone, city, age, how_found_us });
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function requestOtp(req, res) {
  try {
    const result = await authService.requestOtp(req.seller.id);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function verifyOtp(req, res) {
  try {
    const result = await authService.verifyOtp(req.seller.id, req.body.otp);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}

export async function googleLogin(req, res) {
  try {
    const result = await authService.googleLogin(req.body.idToken);
    return res.json(result);
  } catch (err) { handleError(res, err); }
}
