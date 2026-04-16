# AGENTS.md - opencode.cloud

## Project Overview

Hosted platform for opencode — the open-source AI coding agent (140k+ GitHub stars). Users get on-demand, isolated opencode instances in the browser with zero local setup. opencode already ships a web UI (`opencode web`), a headless API (`opencode serve`), and a client/server architecture. We host the server inside Contree microVM sandboxes and serve the existing web frontend, adding the platform layer on top.

**Differentiator**: Branching execution — checkpoint, fork, explore multiple approaches in parallel, rollback. Powered by Contree's immutable snapshots.

**Architecture**: Browser → Cloudflare Workers (auth, routing) → Contree Sandbox (opencode server + real Linux filesystem) → AI providers

## What We Build vs. What Others Provide

### We Build (Platform Layer)
- Session provisioning & lifecycle (create, resume, destroy)
- Auth middleware (JWT, API keys, OAuth)
- Multi-tenant isolation
- Branching UX (checkpoint, fork, rollback, compare)
- Yjs collaboration layer (multi-user editing)
- Git credential management (OAuth)
- Contree API integration (sandbox provisioning, snapshots, branching)
- Rate limiting & abuse prevention
- Landing page & onboarding

### opencode Provides (DO NOT REBUILD)
- Web UI (`opencode web`)
- Headless API server (`opencode serve`)
- AI provider integrations (75+ models)
- Tool execution engine (file ops, bash, etc.)
- Session & conversation management
- Built-in agents (build, plan)
- LSP integration
- MCP / ACP protocol support

### Contree Provides (DO NOT REBUILD)
- MicroVM sandboxes with VM-level isolation
- Real Linux filesystem with full root access and network
- Immutable snapshots after each execution
- Git-like branching and rollback
- Parallel branch execution
- Resource tracking (CPU, memory, I/O)
- REST API, Python SDK, MCP server

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | opencode web UI (served as-is) |
| Collaboration | Yjs CRDT, WebSocket |
| Control Plane | Cloudflare Workers |
| Sandbox Compute | Contree (Nebius) — microVM sandboxes |
| Agent Runtime | opencode (`serve` mode, inside sandbox) |
| User Data | D1 (SQLite) — accounts, session metadata |
| Cross-Session Storage | R2 — exports, templates |
| Auth/Session Store | KV — tokens, settings |
| Auth | JWT (jose), OAuth, API keys |
| Contree Integration | REST API + contree-sdk |

## Commands

```bash
# Development
pnpm install                    # Install all dependencies
pnpm turbo dev                  # Start all dev servers
pnpm exec wrangler dev --port 8787  # Worker only

# Build & Check
pnpm turbo build                # Build all packages
pnpm turbo check                # TypeScript check
pnpm turbo lint                 # ESLint
pnpm turbo test                 # Run tests

# Deploy
pnpm exec wrangler deploy --dry-run  # Validate config
./deploy.sh                     # Production deploy
```

## Project Structure

```
apps/
└── worker/                     # Cloudflare Workers (control plane)
    └── src/
        ├── routes/             # Session CRUD, health, user mgmt, branch ops
        ├── middleware/         # Auth, rate-limit, CORS
        ├── contree/            # Contree API client (provision, snapshot, branch)
        ├── collab/             # Yjs WebSocket server
        └── proxy/              # Proxy requests to Contree sandbox

packages/
├── shared/                     # Shared TypeScript types
└── contree-client/             # Typed wrapper around Contree REST API
```

## Key Constraints

### Contree Sandboxes
- One microVM per user session
- opencode `serve` runs natively inside the VM
- Real Linux filesystem — no VFS adapter needed
- VM-level isolation (stronger than containers)
- Immutable snapshots after each execution

### Branching
- Fork from any snapshot to explore different approaches
- Run N branches in parallel from the same checkpoint
- Rollback to any previous state instantly
- Agent can branch itself via Contree MCP tools

### Collaboration
- Yjs CRDT for document sync on top of opencode's web UI
- Awareness protocol for cursors
- Max 10 clients per session

### Critical M0 Spike
- Benchmark Contree cold start with pre-built opencode image
- Measure latency between Cloudflare Workers and Contree sandbox
- Validate snapshot/resume behavior
- Must complete before committing to the architecture

## Testing

```bash
# Run specific test
pnpm turbo test --filter=worker -- --grep "session"

# E2E tests require wrangler dev running
pnpm exec wrangler dev &
pnpm exec playwright test
```

## Environment Variables

Required in `.dev.vars`:
```
CONTREE_API_KEY=...         # Contree API authentication
AI_API_KEY=sk-...           # OpenAI/Anthropic key (injected into sandboxes)
JWT_SECRET=...              # Auto-generated if missing
GITHUB_TOKEN=...            # For git push tests only
```

## Common Gotchas

1. **Wrangler validation**: Use `wrangler deploy --dry-run`, not `wrangler validate`
2. **opencode is a dependency, not a fork**: Don't rebuild its UI, agent, or tools
3. **Contree snapshots are immutable**: Every execution produces a new snapshot UUID; plan for storage costs
4. **WebSocket proxy**: Workers proxy WebSocket from browser to sandbox; mind the latency hop
5. **API keys in sandboxes**: Inject at runtime via env vars, never write to the filesystem
6. **Cold starts**: Target <5s new, <2s resume; use pre-built images and pre-warmed pool

## Plan Reference

Full implementation plan: `.sisyphus/plans/opencode-cloud-serverless.md`
PRD: `.sisyphus/drafts/opencode-cloud-prd.md`
