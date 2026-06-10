// src/index.js
import "dotenv/config";
import express   from "express";
import cors      from "cors";
import rateLimit from "express-rate-limit";

import authRoutes     from "./auth/authRoutes.js";
import productsRoutes from "./products/productsRoutes.js";
import storeRoutes    from "./store/storeRoutes.js";
import imagesRoutes   from "./images/imagesRoutes.js";
import purchaseRoutes      from "./purchase/purchaseRoutes.js";
import payoutsRoutes       from "./payouts/payoutsRoutes.js";
import aiAssistantRoutes   from "./ai-assistant/aiAssistantRoutes.js";
import { publicRouter as chatPublicRouter, sellerRouter as chatSellerRouter } from "./chat/chatRoutes.js";
import adminAuthRoutes  from "./admin/adminAuthRoutes.js";
import adminRoutes      from "./admin/adminRoutes.js";
import { adminChatRouter, adminMonitorRouter, sellerAdminChatRouter } from "./admin/adminChatRoutes.js";
import { consumerPublicRouter, consumerAdminRouter } from "./consumer/consumerChatRoutes.js";
import onboardingRoutes    from "./onboarding/onboardingRoutes.js";
import subscriptionRoutes from "./subscriptions/subscriptionRoutes.js";
import academyRoutes      from "./academy/academyRoutes.js";
import { startStockListener }    from "./stock/stockListener.js";
import { startCampaignScheduler } from "./email/campaignService.js";
import { startShippingTracker }   from "./jobs/shippingTracker.js";

const app  = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1); // Nginx sits in front — trust the first proxy for rate limiting

const SELLER_APP    = process.env.SELLER_APP_URL;
const STORE_DOMAIN  = process.env.STORE_PAGE_DOMAIN;
const ADMIN_PANEL   = process.env.ADMIN_PANEL_URL;
const ACADEMY_URL   = process.env.ACADEMY_URL;

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (origin.startsWith("http://localhost:")) return cb(null, true);
    if (SELLER_APP  && origin === SELLER_APP)  return cb(null, true);
    if (ADMIN_PANEL && origin === ADMIN_PANEL) return cb(null, true);
    if (ACADEMY_URL && origin === ACADEMY_URL) return cb(null, true);
    if (STORE_DOMAIN && (
      origin === `https://${STORE_DOMAIN}` ||
      origin.endsWith(`.${STORE_DOMAIN}`)
    )) return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));
app.use(express.json({ limit: "5mb" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Demasiados intentos. Esperá 15 minutos antes de intentar de nuevo." },
});

const checkoutLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Demasiados pedidos desde tu IP. Intentá más tarde." },
});

app.post("/seller/auth/login",    authLimiter);
app.post("/seller/auth/register", authLimiter);
app.post("/seller/auth/google",   authLimiter);
app.use("/seller/auth",           authRoutes);
app.use("/seller/products",       productsRoutes);
app.use("/seller/store",          storeRoutes);
app.use("/seller/images",         imagesRoutes);
app.use("/seller/chat",           chatSellerRouter);
app.use("/seller/chat/admin",     sellerAdminChatRouter);
app.use("/store/:slug/chat",      chatPublicRouter);
app.post("/seller/purchase/public/:slug/checkout", checkoutLimiter);
app.use("/seller/purchase",       purchaseRoutes);
app.use("/seller/payouts",        payoutsRoutes);
app.use("/seller/ai-assistant",   aiAssistantRoutes);
app.use("/seller/onboarding",     onboardingRoutes);
app.use("/seller/subscriptions",  subscriptionRoutes);
app.use("/academy",               academyRoutes);

app.use("/admin/auth",             adminAuthRoutes);
app.use("/admin",                  adminRoutes);
app.use("/admin/chat",             adminChatRouter);
app.use("/admin/monitor",          adminMonitorRouter);
app.use("/admin/consumer-chat",    consumerAdminRouter);

app.use("/consumer",               consumerPublicRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Seller API corriendo en :${PORT}`));
startStockListener();
startCampaignScheduler();
startShippingTracker();

// Evita que la API crashee por promesas rechazadas sin capturar
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason?.message || reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err?.message || err);
});
