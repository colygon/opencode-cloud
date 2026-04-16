import { Hono } from "hono";
import type { ApiResponse } from "@opencode-cloud/shared";
import type { Env } from "../index.js";

const health = new Hono<{ Bindings: Env }>();

health.get("/api/health", (c) => {
  return c.json<ApiResponse<{ status: string; timestamp: string }>>({
    ok: true,
    data: {
      status: "healthy",
      timestamp: new Date().toISOString(),
    },
  });
});

export { health };
