import { Router } from "express";
import requireAdminJWT from "../middleware/requireAdminJWT.js";
import * as service from "./adminAuthService.js";

const router = Router();

router.post("/login", async (req, res) => {
  try {
    const data = await service.login(req.body.email, req.body.password);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

router.get("/me", requireAdminJWT, async (req, res) => {
  try {
    const data = await service.me(req.admin.id);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

export default router;
