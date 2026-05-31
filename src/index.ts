import cors from "cors";
import express from "express";
import { pool } from "./db.js";
import { runMigrations } from "./migrate.js";
import { adminRouter } from "./routes/admin.js";
import { orderRouter } from "./routes/order.js";
import { trackRouter } from "./routes/track.js";

function parseCorsOrigins(): string[] | true {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      return ["https://sahha.online", "https://www.sahha.online"];
    }
    return true;
  }
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

async function main(): Promise<void> {
  await runMigrations();

  const app = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(
    cors({
      origin: parseCorsOrigins(),
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.get("/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true, service: "sahhaonline-api" });
    } catch {
      res.status(503).json({ ok: false, service: "sahhaonline-api" });
    }
  });

  app.use("/api/order", orderRouter());
  app.use("/api/track", trackRouter());
  app.use("/api/admin", adminRouter());

  const port = Number(process.env.PORT ?? 4000);
  app.listen(port, "0.0.0.0", () => {
    console.log(`[api] listening on :${port}`);
  });
}

main().catch((e) => {
  console.error("[api] startup failed", e);
  process.exit(1);
});
