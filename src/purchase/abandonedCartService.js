import * as repo from "./abandonedCartRepository.js";

export async function saveAbandonedCart({ sellerId, pageId, slug, customer, items, total }) {
  try {
    return await repo.saveAbandonedCart({ sellerId, pageId, slug, customer, items, total });
  } catch (err) {
    console.error("[abandonedCart] saveAbandonedCart error:", err.message);
    return null;
  }
}

export async function markAbandonedCartPaid(sellerId, customerEmail) {
  try {
    await repo.markAbandonedCartPaidByEmail(sellerId, customerEmail);
  } catch (err) {
    console.error("[abandonedCart] markPaid error:", err.message);
  }
}

export async function getAbandonedCartsForPage(pageId) {
  return repo.getAbandonedCartsForPage(pageId);
}
