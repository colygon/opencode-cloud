import { Hono } from "hono";
import type {
  ApiResponse,
  Branch,
  BranchRequest,
  BranchTreeNode,
  Session,
} from "@opencode-cloud/shared";
import type { AuthEnv } from "../middleware/auth.js";
import { authMiddleware } from "../middleware/auth.js";
import { getContreeClient } from "../lib/contree.js";
import {
  snapshotSession,
  branchFromSnapshot,
  rollbackToSnapshot,
} from "../lib/session-provisioner.js";

const branches = new Hono<AuthEnv>();

branches.use("/sessions/:id/*", authMiddleware);

/** Helper to load and authorize a session */
async function loadSession(
  kv: KVNamespace,
  sessionId: string,
  userId: string,
): Promise<Session | null> {
  const data = await kv.get(`session:${sessionId}`);
  if (!data) return null;
  const session = JSON.parse(data) as Session;
  if (session.userId !== userId) return null;
  return session;
}

/** POST /sessions/:id/snapshot — Create a checkpoint */
branches.post("/sessions/:id/snapshot", async (c) => {
  const sessionId = c.req.param("id");
  const userId = c.get("userId");

  const session = await loadSession(c.env.SESSIONS_KV, sessionId, userId);
  if (!session) {
    return c.json<ApiResponse<never>>(
      { ok: false, error: { code: "NOT_FOUND", message: "Session not found" } },
      404,
    );
  }

  if (!session.snapshotId) {
    return c.json<ApiResponse<never>>(
      {
        ok: false,
        error: {
          code: "SESSION_NOT_READY",
          message: "Session is not ready for snapshots",
        },
      },
      400,
    );
  }

  try {
    const contree = getContreeClient(c.env);
    const contreeSnapshotImageId = await snapshotSession(
      contree,
      session.snapshotId,
    );

    const snapshotId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Store snapshot metadata with the Contree image ID
    await c.env.SESSIONS_KV.put(
      `snapshot:${snapshotId}`,
      JSON.stringify({
        id: snapshotId,
        sessionId,
        parentSnapshotId: session.snapshotId,
        contreeImageId: contreeSnapshotImageId,
        createdAt: now,
      }),
    );

    // Update session's current snapshot
    session.snapshotId = snapshotId;
    session.updatedAt = now;
    await c.env.SESSIONS_KV.put(`session:${sessionId}`, JSON.stringify(session));

    // Track snapshots for the session
    const snapshotsKey = `session-snapshots:${sessionId}`;
    const raw = await c.env.SESSIONS_KV.get(snapshotsKey);
    const snapshotIds: string[] = raw ? JSON.parse(raw) : [];
    snapshotIds.push(snapshotId);
    await c.env.SESSIONS_KV.put(snapshotsKey, JSON.stringify(snapshotIds));

    return c.json<ApiResponse<{ snapshotId: string; createdAt: string }>>({
      ok: true,
      data: { snapshotId, createdAt: now },
    }, 201);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create snapshot";
    return c.json<ApiResponse<never>>(
      {
        ok: false,
        error: {
          code: "SNAPSHOT_FAILED",
          message,
        },
      },
      500,
    );
  }
});

/** POST /sessions/:id/branch — Fork from a snapshot */
branches.post("/sessions/:id/branch", async (c) => {
  const sessionId = c.req.param("id");
  const userId = c.get("userId");

  const session = await loadSession(c.env.SESSIONS_KV, sessionId, userId);
  if (!session) {
    return c.json<ApiResponse<never>>(
      { ok: false, error: { code: "NOT_FOUND", message: "Session not found" } },
      404,
    );
  }

  const body = await c.req.json<BranchRequest>();

  // Verify the snapshot exists and is owned by this session
  const snapshotData = await c.env.SESSIONS_KV.get(`snapshot:${body.snapshotId}`);
  if (!snapshotData) {
    return c.json<ApiResponse<never>>(
      { ok: false, error: { code: "NOT_FOUND", message: "Snapshot not found" } },
      404,
    );
  }

  const snapshot = JSON.parse(snapshotData) as {
    id: string;
    sessionId: string;
    parentSnapshotId?: string;
    contreeImageId?: string;
    createdAt: string;
  };

  if (snapshot.sessionId !== sessionId) {
    return c.json<ApiResponse<never>>(
      { ok: false, error: { code: "NOT_FOUND", message: "Snapshot not found" } },
      404,
    );
  }

  try {
    const contree = getContreeClient(c.env);
    const contreeImageId = snapshot.contreeImageId || body.snapshotId;

    // In Contree, branching is implicit — the snapshot is the checkpoint
    // We just record the branch metadata
    const branchResult = await branchFromSnapshot(
      contree,
      contreeImageId,
      body.name,
    );

    const branchId = crypto.randomUUID();
    const now = new Date().toISOString();

    const branch: Branch = {
      id: branchId,
      sessionId,
      parentSnapshotId: body.snapshotId,
      snapshotId: branchResult.branchImageId,
      name: body.name ?? `branch-${branchId.slice(0, 8)}`,
      createdAt: now,
    };

    await c.env.SESSIONS_KV.put(`branch:${branchId}`, JSON.stringify(branch));

    // Track branches for the session
    const branchesKey = `session-branches:${sessionId}`;
    const raw = await c.env.SESSIONS_KV.get(branchesKey);
    const branchIds: string[] = raw ? JSON.parse(raw) : [];
    branchIds.push(branchId);
    await c.env.SESSIONS_KV.put(branchesKey, JSON.stringify(branchIds));

    return c.json<ApiResponse<Branch>>({ ok: true, data: branch }, 201);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create branch";
    return c.json<ApiResponse<never>>(
      {
        ok: false,
        error: {
          code: "BRANCH_FAILED",
          message,
        },
      },
      500,
    );
  }
});

/** POST /sessions/:id/rollback — Rollback to a snapshot ID */
branches.post("/sessions/:id/rollback", async (c) => {
  const sessionId = c.req.param("id");
  const userId = c.get("userId");

  const session = await loadSession(c.env.SESSIONS_KV, sessionId, userId);
  if (!session) {
    return c.json<ApiResponse<never>>(
      { ok: false, error: { code: "NOT_FOUND", message: "Session not found" } },
      404,
    );
  }

  const { snapshotId } = await c.req.json<{ snapshotId: string }>();

  // Verify the snapshot exists
  const snapshotData = await c.env.SESSIONS_KV.get(`snapshot:${snapshotId}`);
  if (!snapshotData) {
    return c.json<ApiResponse<never>>(
      { ok: false, error: { code: "NOT_FOUND", message: "Snapshot not found" } },
      404,
    );
  }

  const snapshot = JSON.parse(snapshotData) as {
    id: string;
    sessionId: string;
    contreeImageId?: string;
  };

  if (snapshot.sessionId !== sessionId) {
    return c.json<ApiResponse<never>>(
      { ok: false, error: { code: "NOT_FOUND", message: "Snapshot not found" } },
      404,
    );
  }

  try {
    const contree = getContreeClient(c.env);
    const contreeImageId = snapshot.contreeImageId || snapshotId;

    // Rollback in Contree
    const result = await rollbackToSnapshot(contree, contreeImageId);

    const now = new Date().toISOString();
    session.snapshotId = snapshotId;
    session.updatedAt = now;
    await c.env.SESSIONS_KV.put(`session:${sessionId}`, JSON.stringify(session));

    return c.json<ApiResponse<{ snapshotId: string; rolledBackAt: string }>>({
      ok: true,
      data: { snapshotId, rolledBackAt: now },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to rollback";
    return c.json<ApiResponse<never>>(
      {
        ok: false,
        error: {
          code: "ROLLBACK_FAILED",
          message,
        },
      },
      500,
    );
  }
});

/** GET /sessions/:id/branches — Get the branch tree for a session */
branches.get("/sessions/:id/branches", async (c) => {
  const sessionId = c.req.param("id");
  const userId = c.get("userId");

  const session = await loadSession(c.env.SESSIONS_KV, sessionId, userId);
  if (!session) {
    return c.json<ApiResponse<never>>(
      { ok: false, error: { code: "NOT_FOUND", message: "Session not found" } },
      404,
    );
  }

  // Load all snapshots for this session
  const snapshotsKey = `session-snapshots:${sessionId}`;
  const rawSnapshots = await c.env.SESSIONS_KV.get(snapshotsKey);
  const snapshotIds: string[] = rawSnapshots ? JSON.parse(rawSnapshots) : [];

  const snapshots: Array<{
    id: string;
    sessionId: string;
    parentSnapshotId?: string;
    createdAt: string;
  }> = [];

  for (const id of snapshotIds) {
    const data = await c.env.SESSIONS_KV.get(`snapshot:${id}`);
    if (data) snapshots.push(JSON.parse(data));
  }

  // Build tree structure
  const nodeMap = new Map<string, BranchTreeNode>();
  for (const snap of snapshots) {
    nodeMap.set(snap.id, {
      snapshotId: snap.id,
      parentSnapshotId: snap.parentSnapshotId,
      children: [],
      createdAt: snap.createdAt,
    });
  }

  const roots: BranchTreeNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parentSnapshotId && nodeMap.has(node.parentSnapshotId)) {
      nodeMap.get(node.parentSnapshotId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return c.json<ApiResponse<BranchTreeNode[]>>({ ok: true, data: roots });
});

export { branches };
