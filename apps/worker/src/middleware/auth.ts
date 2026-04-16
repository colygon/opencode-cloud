import { createMiddleware } from "hono/factory";
import { jwtVerify } from "jose";
import type { ApiResponse } from "@opencode-cloud/shared";
import type { Env } from "../index.js";

export type AuthEnv = {
  Bindings: Env;
  Variables: { userId: string };
};

/**
 * Auth middleware — verifies either a JWT Bearer token or an X-API-Key header.
 * On success, sets `userId` on the Hono context.
 */
export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const apiKeyHeader = c.req.header("X-API-Key");

  // --- Try JWT Bearer token ---
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    try {
      const secret = new TextEncoder().encode(c.env.JWT_SECRET);
      const { payload } = await jwtVerify(token, secret);
      const userId = payload.sub;
      if (!userId) {
        return c.json<ApiResponse<never>>(
          { ok: false, error: { code: "UNAUTHORIZED", message: "Token missing sub claim" } },
          401,
        );
      }
      c.set("userId", userId);
      return next();
    } catch {
      return c.json<ApiResponse<never>>(
        { ok: false, error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } },
        401,
      );
    }
  }

  // --- Try X-API-Key header (lookup in KV) ---
  if (apiKeyHeader) {
    const stored = await c.env.SESSIONS_KV.get(`apikey:${apiKeyHeader}`);
    if (stored) {
      const data = JSON.parse(stored) as { userId: string };
      c.set("userId", data.userId);
      return next();
    }
    return c.json<ApiResponse<never>>(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Invalid API key" } },
      401,
    );
  }

  return c.json<ApiResponse<never>>(
    { ok: false, error: { code: "UNAUTHORIZED", message: "Missing authentication" } },
    401,
  );
});
