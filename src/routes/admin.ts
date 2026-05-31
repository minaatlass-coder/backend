import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import {
  adminAuthConfigured,
  requireAdmin,
  signAdminToken,
  verifyAdminCredentials,
} from "../lib/auth.js";
import {
  getAdminOrder,
  getDashboardStats,
  listAdminOrders,
  parseDateRange,
} from "../lib/admin-stats.js";

interface LoginBody {
  username?: string;
  password?: string;
}

export function adminRouter(): Router {
  const router = createRouter();

  router.post("/login", (req: Request, res: Response) => {
    if (!adminAuthConfigured()) {
      res.status(503).json({
        ok: false,
        error: "Admin non configuré (ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_SESSION_SECRET).",
      });
      return;
    }
    const body = req.body as LoginBody;
    const username = (body.username ?? "").trim();
    const password = body.password ?? "";
    if (!username || !password) {
      res.status(400).json({ ok: false, error: "Identifiants requis." });
      return;
    }
    if (!verifyAdminCredentials(username, password)) {
      res.status(401).json({ ok: false, error: "Identifiants incorrects." });
      return;
    }
    const token = signAdminToken();
    res.json({ ok: true, token });
  });

  router.get("/me", (req: Request, res: Response) => {
    if (!requireAdmin(req)) {
      res.status(401).json({ ok: false, error: "Non authentifié." });
      return;
    }
    res.json({ ok: true, user: "admin" });
  });

  router.get("/stats", async (req: Request, res: Response) => {
    if (!requireAdmin(req)) {
      res.status(401).json({ ok: false, error: "Non authentifié." });
      return;
    }
    const range = parseDateRange(
      String(req.query.from ?? ""),
      String(req.query.to ?? ""),
    );
    if ("error" in range) {
      res.status(400).json({ ok: false, error: range.error });
      return;
    }
    try {
      const stats = await getDashboardStats(range);
      res.json({ ok: true, stats });
    } catch (e) {
      console.error("[admin stats]", e);
      res.status(500).json({ ok: false, error: "Erreur serveur." });
    }
  });

  router.get("/orders", async (req: Request, res: Response) => {
    if (!requireAdmin(req)) {
      res.status(401).json({ ok: false, error: "Non authentifié." });
      return;
    }
    const range = parseDateRange(
      String(req.query.from ?? ""),
      String(req.query.to ?? ""),
    );
    if ("error" in range) {
      res.status(400).json({ ok: false, error: range.error });
      return;
    }
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20) || 20));
    try {
      const { orders, total } = await listAdminOrders(range, page, limit);
      res.json({ ok: true, orders, total, page, limit });
    } catch (e) {
      console.error("[admin orders]", e);
      res.status(500).json({ ok: false, error: "Erreur serveur." });
    }
  });

  router.get("/orders/:orderId", async (req: Request, res: Response) => {
    if (!requireAdmin(req)) {
      res.status(401).json({ ok: false, error: "Non authentifié." });
      return;
    }
    const orderId = String(req.params.orderId ?? "").trim();
    if (!orderId) {
      res.status(400).json({ ok: false, error: "order_id requis." });
      return;
    }
    try {
      const order = await getAdminOrder(orderId);
      if (!order) {
        res.status(404).json({ ok: false, error: "Commande introuvable." });
        return;
      }
      res.json({ ok: true, order });
    } catch (e) {
      console.error("[admin order]", e);
      res.status(500).json({ ok: false, error: "Erreur serveur." });
    }
  });

  return router;
}
