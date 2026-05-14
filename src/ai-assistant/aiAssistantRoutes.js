import { Router }      from "express";
import requireSeller   from "../middleware/requireSeller.js";
import { chat, getSellerContext } from "./aiAssistantService.js";

const router = Router();

router.post("/chat", requireSeller, async (req, res) => {
  const { messages, pageId } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ message: "messages requerido" });
  }

  try {
    const sellerContext = await getSellerContext(req.seller.id, pageId || null);
    const reply = await chat(messages, sellerContext);
    res.json({ reply });
  } catch (err) {
    const isConfig = err.message?.includes("OPENAI_API_KEY");
    res.status(isConfig ? 503 : 500).json({
      message: isConfig
        ? "El asistente no está configurado aún."
        : "Error al procesar tu consulta. Intentá de nuevo.",
    });
  }
});

export default router;
