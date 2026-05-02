import { Router }      from "express";
import requireSeller   from "../middleware/requireSeller.js";
import { chat }        from "./aiAssistantService.js";

const router = Router();

router.post("/chat", requireSeller, async (req, res) => {
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ message: "messages requerido" });
  }

  try {
    const reply = await chat(messages);
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
