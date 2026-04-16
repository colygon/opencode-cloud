import { Hono } from "hono";
import type { ApiResponse } from "@opencode-cloud/shared";
import { health } from "./routes/health.js";
import { sessions } from "./routes/sessions.js";
import { branches } from "./routes/branches.js";
import { proxy } from "./routes/proxy.js";

export interface Env {
  SESSIONS_KV: KVNamespace;
  DB: D1Database;
  CONTREE_API_KEY: string;
  JWT_SECRET: string;
  ENVIRONMENT: string;
}

const app = new Hono<{ Bindings: Env }>();

// Mount route groups
app.route("/", health);
app.route("/api", sessions);
app.route("/api", branches);
app.route("/", proxy); // Proxy must be last to catch all /s/* paths

// Global error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json<ApiResponse<never>>(
    {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message:
          c.env.ENVIRONMENT === "production"
            ? "An internal error occurred"
            : err.message,
      },
    },
    500,
  );
});

// 404 fallback
app.notFound((c) => {
  return c.json<ApiResponse<never>>(
    { ok: false, error: { code: "NOT_FOUND", message: "Route not found" } },
    404,
  );
});

export default app;
