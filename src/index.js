// src/index.js
import "dotenv/config";
import express from "express";
import cors    from "cors";

import authRoutes     from "./auth/authRoutes.js";
import productsRoutes from "./products/productsRoutes.js";
import storeRoutes    from "./store/storeRoutes.js";
import imagesRoutes   from "./images/imagesRoutes.js";
import purchaseRoutes from "./purchase/purchaseRoutes.js";
import payoutsRoutes  from "./payouts/payoutsRoutes.js";
import { publicRouter as chatPublicRouter, sellerRouter as chatSellerRouter } from "./chat/chatRoutes.js";
import adminAuthRoutes  from "./admin/adminAuthRoutes.js";
import adminRoutes      from "./admin/adminRoutes.js";
import { adminChatRouter, adminMonitorRouter, sellerAdminChatRouter } from "./admin/adminChatRoutes.js";

const app  = express();
const PORT = process.env.PORT || 3000;

const SELLER_APP    = process.env.SELLER_APP_URL;
const STORE_DOMAIN  = process.env.STORE_PAGE_DOMAIN;
const ADMIN_PANEL   = process.env.ADMIN_PANEL_URL;

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (origin.startsWith("http://localhost:")) return cb(null, true);
    if (SELLER_APP  && origin === SELLER_APP)  return cb(null, true);
    if (ADMIN_PANEL && origin === ADMIN_PANEL) return cb(null, true);
    if (STORE_DOMAIN && (
      origin === `https://${STORE_DOMAIN}` ||
      origin.endsWith(`.${STORE_DOMAIN}`)
    )) return cb(null, true);
    if (!SELLER_APP && !STORE_DOMAIN && !ADMIN_PANEL) return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));
app.use(express.json());

app.use("/seller/auth",        authRoutes);
app.use("/seller/products",    productsRoutes);
app.use("/seller/store",       storeRoutes);
app.use("/seller/images",      imagesRoutes);
app.use("/seller/chat",        chatSellerRouter);
app.use("/seller/chat/admin",  sellerAdminChatRouter);
app.use("/store/:slug/chat",   chatPublicRouter);
app.use("/seller/purchase",    purchaseRoutes);
app.use("/seller/payouts",     payoutsRoutes);

app.use("/admin/auth",         adminAuthRoutes);
app.use("/admin",              adminRoutes);
app.use("/admin/chat",         adminChatRouter);
app.use("/admin/monitor",      adminMonitorRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Seller API corriendo en :${PORT}`));
