// src/index.js
import "dotenv/config";
import express from "express";
import cors    from "cors";

import authRoutes     from "./auth/authRoutes.js";
import productsRoutes from "./products/productsRoutes.js";
import storeRoutes    from "./store/storeRoutes.js";
import imagesRoutes   from "./images/imagesRoutes.js";
import { publicRouter as chatPublicRouter, sellerRouter as chatSellerRouter } from "./chat/chatRoutes.js";
import { runMigrations } from "./database/runMigrations.js";

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: process.env.SELLER_APP_URL || "*" }));
app.use(express.json());

app.use("/seller/auth",     authRoutes);
app.use("/seller/products", productsRoutes);
app.use("/seller/store",    storeRoutes);
app.use("/seller/images",   imagesRoutes);
app.use("/seller/chat",     chatSellerRouter);
app.use("/store/:slug/chat", chatPublicRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));


app.listen(PORT, () => console.log(`Seller API corriendo en :${PORT}`));
