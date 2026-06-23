// src/config/mailer.js
import nodemailer from "nodemailer";

export const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST_AWS,
  port:   Number(process.env.SMTP_PORT_AWS) || 587,
  secure: false, // STARTTLS en puerto 587
  auth: { user: process.env.SMTP_USER_AWS, pass: process.env.SMTP_PASS_AWS },
});
