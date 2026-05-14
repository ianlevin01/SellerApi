import { getOnboardingProgress, dismissOnboarding } from "./onboardingRepository.js";

export async function handleGetProgress(req, res) {
  try {
    const progress = await getOnboardingProgress(req.seller.id);
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
