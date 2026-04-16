import { Hono } from "hono";
import type { AuthEnv } from "../middleware/auth.js";
import { authMiddleware } from "../middleware/auth.js";
import type { ApiResponse, Session } from "@opencode-cloud/shared";
import {
  getSandboxUrl,
  forwardHttpRequest,
  forwardWebSocketRequest,
  isWebSocketUpgrade,
} from "../lib/proxy.js";

const proxy = new Hono<AuthEnv>();

proxy.use("/s/:sessionId/*", authMiddleware);

/**
 * Helper to load and authorize a session for proxy requests
 */
async function loadSessionForProxy(
  kv: KVNamespace,
  sessionId: string,
  userId: string,
): Promise<Session | null> {
  const data = await kv.get(`session:${sessionId}`);
  if (!data) return null;
  const session = JSON.parse(data) as Session;
  // Allow access if:
  // 1. User owns the session, OR
  // 2. Session is shared with the user (TODO: implement session sharing)
  if (session.userId !== userId) return null;
  return session;
}

/**
 * Proxy all requests to /s/:sessionId/* to the opencode server in the sandbox
 */
proxy.all("/s/:sessionId/*", async (c) => {
  const sessionId = c.req.param("sessionId");
  const userId = c.get("userId");

  // Load session and verify ownership
  const session = await loadSessionForProxy(
    c.env.SESSIONS_KV,
    sessionId,
    userId,
  );

  if (!session) {
    return c.json<ApiResponse<never>>(
      {
        ok: false,
        error: { code: "NOT_FOUND", message: "Session not found" },
      },
      404,
    );
  }

  if (session.status !== "running") {
    return c.json<ApiResponse<never>>(
      {
        ok: false,
        error: {
          code: "SESSION_NOT_RUNNING",
          message: `Session is ${session.status}`,
        },
      },
      400,
    );
  }

  try {
    // Get the sandbox URL
    const sandboxUrl = getSandboxUrl(session);

    // Extract the path (everything after /s/:sessionId)
    const path = "/" + c.req.path.split("/").slice(3).join("/");

    // Check if this is a WebSocket upgrade request
    if (isWebSocketUpgrade(c.req.raw)) {
      try {
        return await forwardWebSocketRequest(sandboxUrl, path, c.req.raw);
      } catch (wsError) {
        const message =
          wsError instanceof Error ? wsError.message : "WebSocket error";
        return c.json<ApiResponse<never>>(
          {
            ok: false,
            error: { code: "WEBSOCKET_ERROR", message },
          },
          502,
        );
      }
    }

    // Otherwise, forward as a normal HTTP request
    const init: RequestInit = {
      method: c.req.method,
      headers: c.req.header() as HeadersInit,
      body: ["GET", "HEAD", "OPTIONS"].includes(c.req.method)
        ? undefined
        : await c.req.arrayBuffer(),
    };

    const response = await forwardHttpRequest(sandboxUrl, path, init);

    // Return the response (headers, status, body)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error during proxy";

    return c.json<ApiResponse<never>>(
      {
        ok: false,
        error: { code: "PROXY_ERROR", message },
      },
      502,
    );
  }
});

export { proxy };
