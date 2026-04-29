import { Router } from "express";
import requireAdminJWT from "../middleware/requireAdminJWT.js";
import * as svc from "./adminService.js";

const router = Router();
router.use(requireAdminJWT);

const h = fn => async (req, res) => {
  try { res.json(await fn(req, res)); }
  catch (err) { res.status(err.status || 500).json({ message: err.message }); }
};

// Dashboard
router.get("/dashboard/stats", h(() => svc.getDashboard()));

// Sellers
router.get("/sellers",             h(() => svc.getSellers()));
router.get("/sellers/:id",         h(req => svc.getSellerDetail(req.params.id)));
router.patch("/sellers/:id/block", h(req => svc.blockSeller(req.params.id, true)));
router.patch("/sellers/:id/unblock", h(req => svc.blockSeller(req.params.id, false)));
router.patch("/sellers/:id/cvu/verify", h(req => svc.verifyCvu(req.params.id, true)));
router.patch("/sellers/:id/cvu/reject", h(req => svc.verifyCvu(req.params.id, false)));

// Orders
router.get("/orders", h(req => svc.getOrders({
  sellerId: req.query.seller_id || null,
  status:   req.query.status   || null,
  from:     req.query.from     || null,
  to:       req.query.to       || null,
  limit:    Number(req.query.limit  || 100),
  offset:   Number(req.query.offset || 0),
})));

// Earnings
router.get("/earnings",              h(req => svc.getEarnings(req.query.status)));
router.patch("/earnings/:id/approve", h(req => svc.approveEarning(req.params.id)));

// Payouts
router.get("/payouts",                    h(req => svc.getPayouts(req.query.status)));
router.patch("/payouts/:id/transferred",  h(req => svc.markPayoutTransferred(req.params.id)));

// Catalog
router.get("/products",                      h(() => svc.getProducts()));
router.put("/products/:id/cost",             h(req => svc.updateProductCost(req.params.id, req.body.cost)));
router.get("/price-config",                  h(() => svc.getPriceConfig()));
router.put("/price-config",                  h(req => svc.updatePriceConfig(req.body.cotizacion)));

export default router;
