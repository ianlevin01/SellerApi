import { Router } from "express";
import jwt from "jsonwebtoken";
import requireAdminJWT from "../middleware/requireAdminJWT.js";
import * as svc from "./adminService.js";
import * as repo from "./adminRepository.js";
import { generateMailHtml, sendTestMail, sendMassMail } from "./mailingService.js";
import { getLabelsPdfForOrders } from "../ml/mlLabelService.js";

const router = Router();
router.use(requireAdminJWT);

const h = fn => async (req, res) => {
  try { res.json(await fn(req, res)); }
  catch (err) { res.status(err.status || 500).json({ message: err.message }); }
};

// Dashboard
router.get("/dashboard/stats", h(() => svc.getDashboard()));

// Metrics
router.get("/metrics", h(() => svc.getMetrics()));

// Sellers
router.get("/sellers",             h(() => svc.getSellers()));
router.get("/sellers/:id",         h(req => svc.getSellerDetail(req.params.id)));
router.patch("/sellers/:id/block", h(req => svc.blockSeller(req.params.id, true)));
router.patch("/sellers/:id/unblock", h(req => svc.blockSeller(req.params.id, false)));
router.patch("/sellers/:id/cvu/verify", h(req => svc.verifyCvu(req.params.id, true)));
router.patch("/sellers/:id/cvu/reject", h(req => svc.verifyCvu(req.params.id, false)));

router.post("/sellers/:id/impersonate", async (req, res) => {
  try {
    const seller = await repo.getSellerBasic(req.params.id);
    if (!seller) return res.status(404).json({ message: "Seller no encontrado" });
    const token = jwt.sign(
      { id: seller.id, email: seller.email, name: seller.name, slug: seller.slug },
      process.env.JWT_SECRET_SELLER,
      { expiresIn: "2h" }
    );
    res.json({ token, seller });
  } catch (err) {
    console.error("[impersonate]", err);
    res.status(500).json({ message: err.message });
  }
});

// Orders
router.patch("/orders/:id/pack", h(req => svc.packOrder(req.params.id, req.body?.tracking_code || null)));
router.patch("/orders/:id/ship", h(req => svc.shipOrderDirect(req.params.id, req.body.tracking_code || null)));
router.get("/orders", h(req => svc.getOrders({
  sellerId: req.query.seller_id || null,
  status:   req.query.status   || null,
  from:     req.query.from     || null,
  to:       req.query.to       || null,
  limit:    Number(req.query.limit  || 100),
  offset:   Number(req.query.offset || 0),
})));

// Earnings
router.get("/earnings", h(req => svc.getEarnings(req.query.status)));

// Payouts
router.get("/payouts",                    h(req => svc.getPayouts(req.query.status)));
router.patch("/payouts/:id/transferred",  h(req => svc.markPayoutTransferred(req.params.id)));

// Reports
router.get("/reports/sales", h(req => svc.getSalesReport({
  from:     req.query.from      || null,
  to:       req.query.to        || null,
  sellerId: req.query.seller_id || null,
})));

// Store analytics (admin, no ownership check)
router.get("/pages/:pageId/analytics", h(req => svc.getPageAnalytics(
  req.params.pageId,
  req.query.from,
  req.query.to,
)));

// Catalog
router.get("/products",                      h(() => svc.getProducts()));
router.put("/products/:id/cost",             h(req => svc.updateProductCost(req.params.id, req.body.cost)));
router.put("/products/:id/dimensions",       h(req => svc.updateProductDimensions(req.params.id, req.body)));
router.get("/price-config",                  h(() => svc.getPriceConfig()));
router.put("/price-config",                  h(req => svc.updatePriceConfig(req.body.cotizacion)));

// Mercado Libre
router.get("/ml/sales", h(req => svc.getMlSales({
  from:         req.query.from   || null,
  to:           req.query.to     || null,
  chargeStatus: req.query.charge_status || null,
})));

router.post("/ml/labels", async (req, res) => {
  try {
    const { orderIds, force } = req.body || {};
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ message: "Faltan orderIds" });
    }
    const { buffer, errors } = await getLabelsPdfForOrders(orderIds, { force: !!force });
    if (errors.length) res.setHeader("X-Label-Warnings", encodeURIComponent(errors.join(" | ")));
    res.setHeader("Content-Type", "application/pdf");
    res.send(buffer);
  } catch (err) {
    console.error("[admin] ml/labels:", err.message);
    res.status(err.status || 500).json({ message: err.message || "No se pudieron generar las etiquetas" });
  }
});

router.get("/ml/wallets",                    h(() => svc.getMlWalletOverview()));
router.get("/ml/sellers/:id/history",        h(req => svc.getMlSellerHistory(req.params.id)));

// Mailing IA
router.post("/mailing/generate", async (req, res) => {
  try {
    const result = await generateMailHtml(req.body.messages, req.body.currentHtml);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || "Error al generar el email" });
  }
});

router.post("/mailing/send-test", async (req, res) => {
  try {
    const result = await sendTestMail(req.body);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || "Error al enviar" });
  }
});

router.post("/mailing/send-mass", async (req, res) => {
  // Validar antes de lanzar el job
  if (!req.body?.html) return res.status(400).json({ message: "html es requerido" });

  // Responder de inmediato — el envío sigue en segundo plano
  res.json({ ok: true, message: "Envío iniciado. Los mails se están despachando en segundo plano." });

  sendMassMail(req.body).then(r => {
    console.log(`[mailing] Envío masivo finalizado: ${r.sent} enviados, ${r.failed} fallidos de ${r.total}`);
  }).catch(err => {
    console.error("[mailing] Error en envío masivo:", err.message);
  });
});

export default router;
