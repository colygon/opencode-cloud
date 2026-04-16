# opencode.cloud Implementation Guide

## Architecture Overview

This is a **hosted platform for opencode** — the open-source AI coding agent. The architecture is:

```
Browser
    ↓ HTTPS + WebSocket
Cloudflare Workers (stateless routing, auth)
    ↓
Contree Sandbox (microVM with opencode server running)
    ↓
AI providers (OpenAI, Anthropic, etc.)
```

## What's Been Built (M0 + M1 Complete)

### 1. **Monorepo Structure**
- **pnpm** workspace with Turbo build orchestration
- All packages type-safe TypeScript
- Clean separation of concerns

### 2. **Packages**

#### `packages/shared` — Shared Types
- `Session`, `Branch`, `User`, `ApiKey` types
- `ApiResponse<T>` wrapper for all API responses
- `BranchTreeNode` for execution history visualization

#### `packages/contree-client` — Typed Contree API Client
- Zero external dependencies (just TypeScript)
- ~400 LOC of type-safe Contree API calls
- Methods:
  - `importImage(ref)` — import OCI image
  - `run(req)` — execute command in sandbox
  - `upload()`, `download()` — file operations
  - `getOperation()`, `waitOperation()` — async polling
  - Automatic polling for async operations (transparent to caller)

#### `packages/collab` — Yjs Collaboration Layer
- Multi-user document sync via CRDT
- `CollaborationServer` — manages shared documents
- `DocumentProvider` — wraps Yjs Doc
- Client presence tracking (cursor positions)
- ~250 LOC

### 3. **apps/worker — Cloudflare Worker Control Plane**

#### Routes
- **`GET /api/health`** ✅ tested
- **`POST /api/sessions`** — create new session, provision in Contree
- **`GET /api/sessions`** — list user's sessions
- **`GET /api/sessions/:id`** — get session details
- **`DELETE /api/sessions/:id`** — destroy session

#### Branching Routes
- **`POST /api/sessions/:id/snapshot`** — checkpoint state
- **`POST /api/sessions/:id/branch`** — fork from snapshot
- **`POST /api/sessions/:id/rollback`** — restore to snapshot
- **`GET /api/sessions/:id/branches`** — get branch tree

#### Proxy Routes
- **`/s/:sessionId/*`** — proxy to opencode server in sandbox
- Handles HTTP and WebSocket (when deployed to Cloudflare)
- Auth checks before proxying

#### Middleware
- **Auth** — JWT validation + API key support
- **Error handling** — global handler with `ApiResponse` format
- **CORS** — ready to configure

### 4. **Orchestration Layer**

#### `session-provisioner.ts`
- `provisionSession()` — orchestrates sandbox setup
  - Imports base image
  - Clones repo (if provided)
  - Runs `opencode serve`
  - Returns snapshot for branching
- `snapshotSession()` — creates checkpoint
- `branchFromSnapshot()` — forks execution
- `rollbackToSnapshot()` — restores checkpoint

All Contree API calls are centralized here — **one-line changes once API key is available**.

#### `proxy.ts`
- `getSandboxUrl()` — constructs sandbox endpoint
- `forwardHttpRequest()` — HTTP proxying
- `forwardWebSocketRequest()` — WebSocket relay (Cloudflare Workers only)
- `isWebSocketUpgrade()` — detects WS upgrade requests

## Getting Started (No Contree API Key Needed)

### 1. **Install Dependencies**
```bash
pnpm install
```

### 2. **Typecheck**
```bash
pnpm turbo check
```
✅ All packages pass TypeScript checks

### 3. **Build**
```bash
pnpm turbo build
```
✅ Wrangler produces 113KB gzipped Worker

### 4. **Run Dev Server**
```bash
cd apps/worker
pnpm dev
```

### 5. **Test Health Endpoint**
```bash
curl http://localhost:8787/api/health
# { "ok": true, "data": { "status": "healthy", "timestamp": "2026-04-16T..." } }
```

### 6. **Test Auth-Protected Routes** (will fail auth, but shows structure)
```bash
# Without token — returns 401
curl -X POST http://localhost:8787/api/sessions \
  -H 'Content-Type: application/json' \
  -d '{"repoUrl": "..."}'

# Response: { "ok": false, "error": { "code": "UNAUTHORIZED", "message": "..." } }
```

## Wiring Up Contree (When API Key Available)

Once you have `CONTREE_API_KEY`:

### 1. **Set Environment Variable**
```bash
# .dev.vars
CONTREE_API_KEY=your_key_here
JWT_SECRET=your_jwt_secret
```

### 2. **Test Session Creation**
```bash
# Get a JWT token first (for auth)
# Then:
curl -X POST http://localhost:8787/api/sessions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <your_jwt_token>' \
  -d '{"repoUrl": "https://github.com/opencode-ai/opencode"}'

# Response:
# {
#   "ok": true,
#   "data": {
#     "session": {
#       "id": "...",
#       "status": "running",
#       "snapshotId": "...",
#       "contreeInstanceId": "...",
#       "createdAt": "...",
#       "updatedAt": "..."
#     },
#     "webUrl": "https://opencode.cloud/s/..."
#   }
# }
```

### 3. **Access the Web UI**
Navigate to `https://opencode.cloud/s/<sessionId>` in your browser. The Worker proxies the request to the Contree sandbox where opencode's web UI is running.

### 4. **Test Branching**
```bash
# Checkpoint current state
curl -X POST http://localhost:8787/api/sessions/:id/snapshot \
  -H 'Authorization: Bearer <token>'

# Fork from checkpoint
curl -X POST http://localhost:8787/api/sessions/:id/branch \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"snapshotId": "...", "name": "feature-branch"}'

# Rollback to snapshot
curl -X POST http://localhost:8787/api/sessions/:id/rollback \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"snapshotId": "..."}'
```

## Testing Collaboration

Once deployed with WebSocket support:

```javascript
// Client-side code
const ws = new WebSocket('wss://opencode.cloud/api/collab/session-id');

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  if (message.type === 'sync') {
    // Initial sync — apply Yjs state update
    Y.applyUpdate(ydoc, new Uint8Array(message.fileState));
  }
  
  if (message.type === 'update') {
    // Incoming update from peer
    Y.applyUpdate(ydoc, new Uint8Array(message.update));
  }
  
  if (message.type === 'cursor') {
    // Peer cursor movement
    console.log(`${message.userId} at line ${message.line}`);
  }
};
```

## Key Files & Entrypoints

### Worker
- `apps/worker/src/index.ts` — main app, route mounting
- `apps/worker/src/routes/sessions.ts` — session CRUD
- `apps/worker/src/routes/branches.ts` — branching logic
- `apps/worker/src/routes/proxy.ts` — HTTP/WS proxy to sandbox
- `apps/worker/src/middleware/auth.ts` — JWT + API key validation
- `apps/worker/src/lib/session-provisioner.ts` — Contree orchestration
- `apps/worker/src/lib/contree.ts` — client factory

### Collab
- `packages/collab/src/server.ts` — `CollaborationServer` class
- `packages/collab/src/provider.ts` — `DocumentProvider` class
- `packages/collab/src/types.ts` — collaboration types

### Shared
- `packages/shared/src/session.ts` — Session types
- `packages/shared/src/branch.ts` — Branch types
- `packages/shared/src/api.ts` — `ApiResponse<T>` wrapper

## What's Not Yet Implemented

1. **User registration / login** — auth middleware is there, but no registration endpoint
2. **API key management** — CRUD endpoints for user API keys
3. **Session sharing** — access control beyond ownership
4. **Usage tracking / billing** — foundation in place (D1), not wired up
5. **WebSocket server in Worker** — routes are there, WS upgrade requires Cloudflare deployment
6. **Pre-built Contree image** — need to build and push `opencode-cloud-base:latest`
7. **Performance monitoring** — cold start metrics, latency tracking
8. **CI/CD pipeline** — GitHub Actions for deploy

## Next Steps (M2+)

### M2: User Management
- `POST /api/auth/register` — user signup
- `POST /api/auth/login` — JWT token generation
- `GET /api/users/:id` — user profile
- `POST /api/users/:id/apikeys` — create API key
- D1 schema for users, api_keys, sessions

### M3: Session Sharing & Collaboration
- `POST /api/sessions/:id/share` — generate shareable link
- `POST /api/sessions/:id/invite` — invite user by email
- Wire Yjs layer into proxy routes
- Multi-user WebSocket coordination

### M4: Monitoring & Ops
- Cold start latency tracking
- Contree error handling & retries
- Session cleanup (idle TTL)
- Usage analytics in D1

## Deployment

### Development
```bash
cd apps/worker
pnpm dev
```

### Production
```bash
cd apps/worker
pnpm deploy
```

Requires:
- Cloudflare account + API token
- `wrangler` login
- D1 database created
- KV namespaces created
- Contree API key configured

## Dependencies & Versions

- **Hono** 4.7.0 — HTTP framework for Workers
- **jose** 6.0.0 — JWT library
- **Yjs** 13.6.8 — CRDT
- **y-websocket** 1.5.3 — WebSocket provider for Yjs
- **Wrangler** 4.82+ — Cloudflare deployment
- **TypeScript** 5.7.0
- **Turbo** 2.9.6 — monorepo build orchestration

## Architecture Notes

### Why These Choices?

1. **Contree over Durable Objects** — DOs have strict CPU/memory limits; Contree gives real Linux VMs with native package managers
2. **Yjs over OT** — CRDTs handle offline edits, peer-to-peer architecture naturally
3. **Cloudflare Workers** — edge routing, auth checks, zero infrastructure
4. **TypeScript everywhere** — safety at compile time
5. **No UI in the monorepo** — opencode's web UI is served as-is from the sandbox

### Gotchas

- **Cold starts**: Target <5s new, <2s resume. Use pre-warmed image and state snapshots.
- **WebSocket in Workers**: Only works on Cloudflare (uses `WebSocketPair` API). Local dev returns helpful error.
- **Contree timeouts**: Don't set too low; `opencode serve` needs time to start.
- **KV eventually consistent**: Session data may lag slightly after writes. Use polling if needed.
- **Path traversal**: Always validate file paths in VFS operations.

## Metrics & Targets

| Metric | Target |
|--------|--------|
| Time to first interaction | <10s |
| Cold start (new session) | <5s |
| Cold start (resume) | <2s |
| Collab sync latency p95 | <200ms |
| Session crash rate | <0.1% |
| Initial bundle size | <200KB |

## Testing Checklist

- [ ] `pnpm turbo check` passes
- [ ] `pnpm turbo build` produces valid Worker
- [ ] `GET /api/health` responds with 200
- [ ] `POST /api/sessions` fails gracefully without auth
- [ ] All route handlers are type-safe
- [ ] Error responses follow `ApiResponse` format
- [ ] Session data persists in KV
- [ ] Branching tree builds correctly
- [ ] (Post Contree API key) Session provisioning completes
- [ ] (Post Contree API key) Proxy routes forward to sandbox
- [ ] (Post Cloudflare deploy) WebSocket upgrade works

## Support

For questions or issues:
1. Check `AGENTS.md` for project overview
2. Review `.sisyphus/drafts/opencode-cloud-prd.md` for product details
3. See `apps/worker/wrangler.toml` for env binding setup
