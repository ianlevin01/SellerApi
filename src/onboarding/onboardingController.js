import { getOnboardingProgress, getOnboardingProgressMl, dismissOnboarding, setOnboardingTrack, getSellerOnboardingTrack } from "./onboardingRepository.js";

export async function handleGetProgress(req, res) {
  try {
    const track = await getSellerOnboardingTrack(req.seller.id);
    const progress = track === "mercadolibre"
      ? await getOnboardingProgressMl(req.seller.id)
      : await getOnboardingProgress(req.seller.id);
    res.json(progress);
  } catch (err) {
    console.error("[onboarding] progress error:", err.message);
    res.status(500).json({ error: "Error al obtener progreso" });
  }
}

export async function handleDismiss(req, res) {
  try {
    await dismissOnboarding(req.seller.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("[onboarding] dismiss error:", err.message);
    res.status(500).json({ error: "Error al guardar" });
  }
}

export async function handleSetTrack(req, res) {
  try {
    const { track } = req.body || {};
    if (!["ecommerce", "mercadolibre"].includes(track)) {
      return res.status(400).json({ error: "Track inválido" });
    }
    const seller = await setOnboardingTrack(req.seller.id, track);
    if (!seller) return res.status(404).json({ error: "No encontrado" });
    res.json(seller);
  } catch (err) {
    console.error("[onboarding] set track error:", err.message);
    res.status(500).json({ error: "Error al guardar" });
  }
}
