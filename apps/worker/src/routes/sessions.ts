import { Hono } from "hono";
import type {
  ApiResponse,
  Session,
  CreateSessionRequest,
  CreateSessionResponse,
} from "@opencode-cloud/shared";
import type { AuthEnv } from "../middleware/auth.js";
import { authMiddleware } from "../middleware/auth.js";
import { getContreeClient } from "../lib/contree.js";
import {
  provisionSession,
  updateSessionWithProvisioningResult,
} from "../lib/session-provisioner.js";

const sessions = new Hono<AuthEnv>();

sessions.use("/api/sessions/*", authMiddleware);
sessions.use("/api/sessions", authMiddleware);

/** POST /api/sessions — Create a new session */
sessions.post("/api/sessions", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<CreateSessionRequest>();
  const contree = getContreeClient(c.env);

  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Create initial session record (provisioning state)
  let session: Session = {
    id: sessionId,
    userId,
    status: "provisioning",
    contreeInstanceId: "",
    snapshotId: "",
    createdAt: now,
    updatedAt: now,
  };

  // Store initial session in KV
  await c.env.SESSIONS_KV.put(
    `session:${sessionId}`,
    JSON.stringify(session),
  );

  // Also maintain a user index
  const userSessionsKey = `user-sessions:${userId}`;
  const existing = await c.env.SESSIONS_KV.get(userSessionsKey);
  const sessionIds: string[] = existing ? JSON.parse(existing) : [];
  sessionIds.push(sessionId);
  await c.env.SESSIONS_KV.put(userSessionsKey, JSON.stringify(sessionIds));

  try {
    // Provision the session in Contree
    const provisioningResult = await provisionSession(contree, {
      repoUrl: body.repoUrl,
      imageId: body.imageId,
    });

    // Update session with provisioning results
    session = updateSessionWithProvisioningResult(session, provisioningResult);

    // Store updated session
    await c.env.SESSIONS_KV.put(
      `session:${sessionId}`,
      JSON.stringify(session),
    );
  } catch (error) {
    // If provisioning fails, mark session as failed
    session.status = "destroyed";
    session.updatedAt = new Date().toISOString();
    await c.env.SESSIONS_KV.put(
      `session:${sessionId}`,
      JSON.stringify(session),
    );

    const message =
      error instanceof Error ? error.message : "Unknown error during provisioning";
    return c.json<ApiResponse<never>>(
      {
        ok: false,
        error: {
          code: "PROVISIONING_FAILED",
          message,
        },
      },
      500,
    );
  }

  const response: CreateSessionResponse = {
    session,
    webUrl: `https://opencode.cloud/s/${sessionId}`,
  };

  return c.json<ApiResponse<CreateSessionResponse>>({ ok: true, data: response }, 201);
});

/** GET /api/sessions — List user's sessions */
sessions.get("/api/sessions", async (c) => {
  const userId = c.get("userId");

  const userSessionsKey = `user-sessions:${userId}`;
  const raw = await c.env.SESSIONS_KV.get(userSessionsKey);
  const sessionIds: string[] = raw ? JSON.parse(raw) : [];

  const results: Session[] = [];
  for (const id of sessionIds) {
    const data = await c.env.SESSIONS_KV.get(`session:${id}`);
    if (data) {
      results.push(JSON.parse(data) as Session);
    }
  }

  return c.json<ApiResponse<Session[]>>({ ok: true, data: results });
});

/** GET /api/sessions/:id — Get session details */
sessions.get("/api/sessions/:id", async (c) => {
  const sessionId = c.req.param("id");
  const userId = c.get("userId");

  const data = await c.env.SESSIONS_KV.get(`session:${sessionId}`);
  if (!data) {
    return c.json<ApiResponse<never>>(
      { ok: false, error: { code: "NOT_FOUND", message: "Session not found" } },
      404,
    );
  }

  const session = JSON.parse(data) as Session;
  if (session.userId !== userId) {
    return c.json<ApiResponse<never>>(
      { ok: false, error: { code: "NOT_FOUND", message: "Session not found" } },
      404,
    );
  }

  return c.json<ApiResponse<Session>>({ ok: true, data: session });
});

/** DELETE /api/sessions/:id — Destroy session */
sessions.delete("/api/sessions/:id", async (c) => {
  const sessionId = c.req.param("id");
  const userId = c.get("userId");

  const data = await c.env.SESSIONS_KV.get(`session:${sessionId}`);
  if (!data) {
    return c.json<ApiResponse<never>>(
      { ok: false, error: { code: "NOT_FOUND", message: "Session not found" } },
      404,
    );
  }

  const session = JSON.parse(data) as Session;
  if (session.userId !== userId) {
    return c.json<ApiResponse<never>>(
      { ok: false, error: { code: "NOT_FOUND", message: "Session not found" } },
      404,
    );
  }

  // Contree sandboxes are ephemeral; no explicit cleanup needed
  // Just mark the session as destroyed in our metadata

  // Update session status
  session.status = "destroyed";
  session.updatedAt = new Date().toISOString();
  await c.env.SESSIONS_KV.put(`session:${sessionId}`, JSON.stringify(session));

  // Remove from user index
  const userSessionsKey = `user-sessions:${userId}`;
  const raw = await c.env.SESSIONS_KV.get(userSessionsKey);
  const sessionIds: string[] = raw ? JSON.parse(raw) : [];
  const filtered = sessionIds.filter((id) => id !== sessionId);
  await c.env.SESSIONS_KV.put(userSessionsKey, JSON.stringify(filtered));

  return c.json<ApiResponse<{ id: string; status: string }>>({
    ok: true,
    data: { id: sessionId, status: "destroyed" },
  });
});

export { sessions };
