import * as service from "./subscriptionService.js";

export async function getStatus(req, res) {
  try {
    const data = await service.getSubscriptionStatus(req.seller.id);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || "Error interno" });
  }
}

export async function subscribe(req, res) {
  try {
    const { plan_id } = req.body;
    if (!plan_id) return res.status(400).json({ message: "plan_id requerido" });

    const result = await service.createSubscription(
      req.seller.id,
      req.seller.email,
      plan_id
    );
    res.json(result);
  } catch (err) {
    // Si es un error de axios (llamada a MP), mostrar el detalle real
    const mpError = err.response?.data;
    if (mpError) {
      console.error("[subscriptions] Error de MercadoPago:", JSON.stringify(mpError, null, 2));
      return res.status(err.response.status || 500).json({
        message: mpError.message || mpError.error || "Error de MercadoPago",
        mp_detail: mpError,
      });
    }
    console.error("[subscriptions] Error:", err.message);
    res.status(err.status || 500).json({ message: err.message || "Error interno" });
  }
}

export async function scheduleDowngrade(req, res) {
  try {
    const { plan_id } = req.body;
    if (!plan_id) return res.status(400).json({ message: "plan_id requerido" });
    await service.scheduleDowngrade(req.seller.id, plan_id);
    return res.json({ ok: true, message: "Downgrade programado para el fin del período actual." });
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message || "Error interno" });
  }
}

export async function link(req, res) {
  try {
    const { preapproval_id } = req.body;
    await service.linkSubscription(req.seller.id, preapproval_id);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[sub link] error:", err.message);
    return res.status(500).json({ message: "Error al vincular suscripción" });
  }
}

export async function retry(req, res) {
  try {
    const result = await service.retrySubscription(req.seller.id, req.seller.email);
    res.json(result);
  } catch (err) {
    const mpError = err.response?.data;
    if (mpError) {
      console.error("[subscriptions] Error de MercadoPago (retry):", JSON.stringify(mpError, null, 2));
      return res.status(err.response.status || 500).json({ message: mpError.message || mpError.error || "Error de MercadoPago" });
    }
    res.status(err.status || 500).json({ message: err.message || "Error interno" });
  }
}

export async function cancel(req, res) {
  try {
    const result = await service.cancelSubscription(req.seller.id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || "Error interno" });
  }
}

// Webhook — NO requiere auth (viene de MP)
export async function webhook(req, res) {
  try {
    const type   = req.query.type || req.body?.type;
    const dataId = req.query["data.id"] || req.body?.data?.id;

    if (!type || !dataId) return res.sendStatus(200);

    await service.handleWebhook(type, dataId);
    res.sendStatus(200);
  } catch (err) {
    console.error("[subscription webhook]", err.message);
    res.sendStatus(200); // siempre 200 para que MP no reintente
  }
}
