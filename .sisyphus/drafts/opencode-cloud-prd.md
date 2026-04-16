# Product Requirements Document: opencode.cloud

**Version**: 0.3 (Draft)
**Date**: 2026-04-15
**Status**: Draft

---

## 1. Problem Statement

opencode is an open-source AI coding agent with 140k+ GitHub stars. It ships a TUI, a desktop app, and a built-in web UI (`opencode web`). Its client/server architecture (`opencode serve` + `opencode attach`) already separates the backend from the frontend.

But there's no **hosted** offering. Today, running opencode requires:

- **Local installation** on every machine you want to use it from
- **Your own compute** — the agent, tool execution, and file I/O all run on your hardware
- **Manual environment setup** — API keys, model configuration, git credentials
- **No shareable URLs** — you can't send someone a link to your session
- **Linear execution only** — if the agent takes a wrong approach, you have to manually undo and retry

opencode.cloud solves this by providing **managed, isolated opencode instances in the cloud**, accessible from any browser with zero local setup — with the ability to **branch, explore, and rollback** execution state like Git.

## 2. Product Vision

**opencode.cloud** is a hosted platform that provisions on-demand opencode instances running in isolated microVM sandboxes (powered by Contree). Each user gets a full opencode environment with the existing web UI, persistent cloud storage, real-time collaboration, and **branching execution** — the ability to checkpoint state, fork into parallel exploration paths, and rollback to any previous point.

The key insight: opencode already has a web UI and a client/server architecture. We don't rebuild the UI — we **host the server** inside Contree sandboxes and **serve the existing web frontend**, adding the platform layer (auth, provisioning, branching, collaboration) on top.

## 3. Target Users

| Persona | Need |
|---------|------|
| **Solo developer** | Use opencode from any device without local setup or API key management |
| **Team** | Share a live coding session via URL; collaborate on the same opencode instance |
| **Educator / presenter** | Demo opencode to an audience with a shareable link |
| **New user** | Try opencode instantly — zero install, zero config |
| **Mobile developer** | Drive opencode from a phone or tablet while it runs on cloud compute |
| **AI researcher** | Evaluate agent strategies with branching — try N approaches from the same checkpoint and keep the best |

## 4. Core Requirements

### 4.1 Managed opencode Instances

**Priority**: P0

- Each session runs a full opencode server inside a Contree microVM sandbox
- The opencode `serve` command provides the headless API backend
- The existing opencode web UI is served to the browser as-is
- Sessions are isolated at the VM level — one user's instance cannot access another's files, state, or kernel

### 4.2 Session Provisioning & Lifecycle

**Priority**: P0

- **Create**: User clicks "New Session" → platform provisions a Contree sandbox, starts opencode server
- **Resume**: Users can return to a previous session; Contree snapshots preserve full filesystem state
- **Destroy**: Users can explicitly delete a session; idle sessions are cleaned up after a configurable TTL
- **Cold start**: Target <5 seconds for new sessions, <2 seconds for resuming from a snapshot

### 4.3 Branching Execution (powered by Contree)

**Priority**: P0 — this is the differentiating feature

- **Checkpoint**: At any point, snapshot the full execution state (files, installed packages, environment)
- **Branch**: Fork from any checkpoint to explore a different approach — the agent can try multiple strategies in parallel from the same starting point
- **Rollback**: Instantly revert to any previous checkpoint if an approach fails
- **Compare**: Run N branches from the same checkpoint, evaluate outcomes, and keep the best one
- Every command execution produces an immutable, versioned snapshot — full audit trail
- Enables "MCTS for code" — tree-search exploration over solution strategies

This is not something we build from scratch. Contree provides this as infrastructure: immutable snapshots, branching, parallel execution, and rollback via its SDK/API.

### 4.4 Cloud Filesystem

**Priority**: P0

- Each session has a real filesystem inside its Contree microVM — full root access, network, standard Linux environment
- opencode's built-in file tools (read, write, patch, glob, grep) work natively — no VFS adapter needed
- Server-side git operations (clone, commit, push, pull) work out of the box
- Contree handles file persistence via immutable snapshots
- Cloudflare R2 used for user-level storage that spans sessions (e.g., exported projects, templates)

### 4.5 Authentication & Multi-Tenancy

**Priority**: P0

- JWT-based authentication (via `jose` library)
- API key support for programmatic/CI access
- Session tokens stored in Cloudflare KV
- Users can only access their own sessions (and sessions explicitly shared with them)
- Rate limiting middleware to prevent abuse

### 4.6 Real-Time Collaboration

**Priority**: P1

- Share a session via URL — recipients join the same opencode instance
- Multiple users see the same file state, chat history, and agent output
- Yjs CRDT for concurrent document editing without conflicts
- Cursor presence and awareness (see collaborators' positions)
- Maximum 10 concurrent clients per session

### 4.7 Model & API Key Management

**Priority**: P1

- Users configure their own AI provider API keys (OpenAI, Anthropic, Google, etc.)
- Platform may offer a default model for free-tier / trial users
- Keys are stored encrypted, scoped to the user, and injected into the opencode sandbox at runtime
- Users can switch models mid-session (opencode already supports this)

### 4.8 Git Integration

**Priority**: P1

- OAuth flow for GitHub/GitLab authentication (no manual token pasting)
- Clone repos into a session workspace
- Commit and push from within the session
- Git credentials scoped per-session, not persisted globally

## 5. Architecture

```
Browser
    |
    | HTTPS + WebSocket
    v
Cloudflare Workers (stateless routing, auth, session lookup)
    |
    v
Contree Sandbox (one microVM per session)
    |
    +---> opencode server (headless API via `serve`)
    |         |
    |         +---> AI providers (OpenAI, Anthropic, Google, etc.)
    |         +---> Tool execution engine
    |         +---> Session & prompt management
    |
    +---> opencode web UI (served to browser)
    |
    +---> Real Linux filesystem (persistent via Contree snapshots)
    |
    +---> Git, LSP, shell — all native in the VM
    |
    +---> Branching layer
              +---> Immutable snapshots after each execution
              +---> Fork from any snapshot
              +---> Parallel branch execution
              +---> Rollback to any previous state

Cloudflare (platform services)
    +---> KV — session tokens, user settings
    +---> R2 — cross-session storage (exports, templates)
    +---> D1 — user accounts, session metadata, billing
```

### Key Architectural Decisions

1. **Contree sandboxes over Durable Objects**: The v0.2 PRD identified "Can opencode run in a DO?" as the biggest risk. Contree eliminates this entirely. Each session is a full microVM with a real Linux filesystem, shell, network, and package manager. opencode runs natively — no VFS adapter, no runtime compatibility hacks. VM-level isolation is stronger than anything DOs could provide.

2. **Cloudflare Workers as the control plane**: Workers handle auth, routing, session lookup, and serving static assets. They don't run opencode — they proxy to Contree. This is what Workers are good at: stateless, fast, edge-located request routing.

3. **Contree branching as a first-class feature**: This is the differentiator. No other hosted coding agent platform offers "fork your workspace, try 3 approaches in parallel, keep the winner." Contree provides this as infrastructure — we expose it in the UI.

4. **Leverage opencode's client/server split**: opencode already separates its backend (`serve`) from its frontend (`web`/`attach`). We run the server in a Contree sandbox and serve the web UI to the browser. No UI rebuild needed.

5. **Real filesystem instead of VFS**: The v0.2 PRD described a hybrid D1+R2 virtual filesystem. With Contree, this is unnecessary. Each sandbox has a real Linux filesystem. opencode's tools work natively. Git works natively. `npm install` works natively. No adapter layer needed.

## 6. What We Build vs. What Others Provide

| We Build (Platform Layer) | opencode Provides | Contree Provides |
|---------------------------|-------------------|------------------|
| Session provisioning & lifecycle | Web UI (`opencode web`) | MicroVM sandboxes |
| Auth middleware (JWT, API keys, OAuth) | Headless API server (`opencode serve`) | VM-level isolation |
| Branching UX (checkpoint, fork, rollback UI) | AI provider integrations (75+ models) | Immutable snapshots |
| Collaboration layer (Yjs) | Tool execution engine | Git-like branching & rollback |
| Git credential management (OAuth) | Session & conversation management | Parallel branch execution |
| Rate limiting & abuse prevention | Built-in agents (build, plan) | Real Linux filesystem |
| Billing / usage tracking | LSP integration | Resource tracking (CPU, memory, I/O) |
| Landing page & onboarding | MCP / ACP protocol support | REST API + MCP server + Python SDK |

## 7. Contree Integration Details

### SDK / API Usage

Contree offers three integration paths. For opencode.cloud:

- **REST API** for session provisioning from Cloudflare Workers (create sandbox, import image, spawn instance)
- **Python SDK** (`contree-sdk`) for any backend orchestration that needs richer control (branching workflows, parallel execution)
- **MCP server** (`contree-mcp`) — potentially exposed directly to opencode instances so the agent itself can branch/checkpoint

### Sandbox Lifecycle

1. **Image**: Pre-built OCI image with opencode pre-installed (`opencode-cloud-base`)
2. **Spawn**: On session create, import image → spawn instance → run `opencode serve`
3. **Snapshot**: Every significant state change (git clone, agent edit, user save) produces an immutable snapshot
4. **Branch**: User or agent forks from a snapshot → new sandbox instance from that point
5. **Cleanup**: Idle sandboxes hibernated after TTL; snapshots retained for resume

### MCP-Powered Agent Branching

Contree's MCP server exposes tools like `run`, `upload`, `download`, `list_files`, `read_file`, `rsync`. Combined with opencode's native MCP support, this opens up a powerful pattern:

- opencode's agent can **use Contree's MCP tools directly** to checkpoint its own state
- The agent can fork itself, try a risky approach, and rollback if tests fail
- Enables autonomous "exploration mode" — the agent tries N strategies and reports the best result

This is "MCTS for code" — Monte Carlo Tree Search over solution strategies, powered by the agent itself.

## 8. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| New session cold start p95 | <5 seconds |
| Session resume (from snapshot) p95 | <2 seconds |
| Collaboration sync latency p95 | <200ms |
| Max concurrent collaborators | 10 per session |
| Session state durability | Survives disconnects; snapshots are immutable |
| Deployment | `./deploy.sh` for Workers; Contree managed by Nebius |
| Security | VM-level isolation, JWT on all routes, encrypted API keys, rate limiting |

## 9. Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend | opencode web UI (as-is) | Already built, maintained upstream |
| Collaboration | Yjs + y-websocket | Battle-tested CRDT |
| Control plane | Cloudflare Workers | Edge routing, auth, session lookup |
| Sandbox compute | Contree (Nebius) | MicroVM isolation, branching, snapshots, real filesystem |
| Agent runtime | opencode (`serve` mode) | Full agent capabilities without rebuilding |
| User data | D1 (SQLite) | User accounts, session metadata |
| Cross-session storage | R2 | Exported projects, templates |
| Session/auth store | KV | Fast global reads for tokens |
| Auth | jose (JWT) | Lightweight, edge-compatible |
| Contree integration | REST API + contree-sdk | Sandbox provisioning, branching |
| Monorepo | pnpm + Turborepo | Fast installs, parallel builds |
| E2E testing | Playwright | Cross-browser |
| Deployment | Wrangler CLI | Cloudflare tooling |

## 10. Project Structure

```
apps/
  worker/                     # Cloudflare Workers (control plane)
    src/
      routes/                 # Session CRUD, health, user mgmt, branch ops
      middleware/             # Auth (JWT/OAuth), rate-limit, CORS
      contree/                # Contree API client (provision, snapshot, branch)
      collab/                 # Yjs WebSocket server
      proxy/                  # Proxy requests to Contree sandbox

packages/
  shared/                     # TypeScript types shared across packages
  contree-client/             # Typed wrapper around Contree REST API
```

## 11. Milestones

### M0: Foundation + Contree Spike (Weeks 1-2)
- Monorepo scaffolding (pnpm + Turbo + Wrangler)
- Basic Worker with health check endpoint
- **Contree proof of concept**: provision a sandbox, install opencode, run `opencode serve`, proxy web UI to browser
- Validate cold start times and snapshot/resume behavior
- CI pipeline (lint, typecheck, test)

### M1: Session Management (Weeks 3-5)
- Session provisioning via Contree API (create, resume from snapshot, destroy)
- Pre-built OCI image with opencode installed
- Proxy opencode's web UI through the Worker to the browser
- Git clone into session workspace
- Idle session TTL and cleanup

### M2: Auth & Multi-Tenancy (Weeks 6-7)
- JWT authentication middleware
- User registration / login flow
- Session ownership and access control
- API key support for programmatic access
- KV-backed session token storage
- Rate limiting

### M3: Branching UX (Weeks 8-10)
- Expose Contree's branching in the UI: checkpoint, fork, rollback, compare
- Branch tree visualization (session history as a tree, not a line)
- Parallel branch execution — try N approaches from same checkpoint
- Agent-initiated branching via Contree MCP tools
- Snapshot management (name, tag, delete)

### M4: Collaboration + Integrations (Weeks 11-13)
- Yjs document provider for multi-user editing
- Cursor awareness and presence indicators
- Shareable session URLs with access control
- User API key management (encrypted storage)
- GitHub/GitLab OAuth for git operations
- Model selection and configuration per session

### M5: Polish + Launch (Weeks 14-15)
- Cold start optimization (pre-warmed sandbox pool)
- E2E test suite (Playwright)
- Production deployment pipeline
- Landing page and onboarding flow
- Usage tracking / billing foundation
- Documentation

## 12. Open Questions

1. **Contree pricing model**: What's the cost per sandbox-hour? Per snapshot? This directly determines our pricing.
2. **Contree latency**: What's the actual cold start for a new sandbox with a pre-built image? Need to benchmark.
3. **Contree region availability**: Where are Contree's microVMs? Latency matters for the WebSocket connection between Worker and sandbox.
4. **Sandbox resource limits**: How much CPU/memory/disk does each sandbox get? Can we configure tiers?
5. **Snapshot storage limits**: How many snapshots per session before cost becomes prohibitive?
6. **Agent-initiated branching**: Should the agent be able to branch autonomously, or only on user request? Autonomous branching is powerful but expensive.
7. **Pricing**: Free tier limits (sessions, compute minutes, snapshots)? Paid tiers?
8. **API key custody**: Do we store user API keys, or require users to bring a key per session?
9. **opencode version pinning**: Pin per session, per user, or global?
10. **Mobile UX**: opencode's web UI may not be mobile-optimized. Is mobile a launch requirement or post-launch?
11. **Offline / disconnect handling**: What happens to a running agent task when the user disconnects? Sandbox keeps running?

## 13. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Contree cold start too slow | >5s new sessions degrades UX | Pre-warmed sandbox pool, pre-built images, benchmark in M0 |
| Contree cost per sandbox-hour too high | Unsustainable unit economics | Aggressive idle cleanup, hibernation, tiered pricing |
| Contree regional latency | Lag between Worker edge and sandbox | Co-locate Workers and Contree where possible; measure in spike |
| Snapshot storage costs accumulate | Unpredictable costs per user | Snapshot retention policies, auto-prune old branches |
| opencode upstream breaking changes | Platform breaks on update | Pin version in base image, integration test suite |
| Yjs integration with opencode's web UI | Collaboration doesn't work cleanly | May need minimal patches to opencode's web frontend |
| API key security | Leak of user credentials | Encrypt at rest, inject at runtime, never persist in sandbox filesystem |
| Contree vendor dependency | Single point of failure for compute | Abstract sandbox interface; Contree API is simple enough to swap |

## 14. Success Metrics

| Metric | Target |
|--------|--------|
| Time to first interaction (new user) | <10 seconds from landing page to chat |
| Session cold start (new) p95 | <5 seconds |
| Session resume (from snapshot) p95 | <2 seconds |
| Branch fork time p95 | <3 seconds |
| Session crash rate | <0.1% |
| Collaboration sync latency p95 | <200ms |
| User retention (7-day) | >30% |
| Branching adoption | >20% of sessions use at least one branch |

## 15. Competitive Advantage

The combination of **opencode + Contree branching** creates something no competitor offers:

1. **vs. GitHub Codespaces / Gitpod**: Those are cloud IDEs. We're a cloud *agent* — the AI does the coding, not just the editing. Plus branching execution.
2. **vs. Cursor / Windsurf cloud**: No branching. Linear execution only. Can't fork-and-compare approaches.
3. **vs. self-hosted opencode**: We eliminate setup, provide collaboration, and add branching that doesn't exist locally.
4. **vs. ChatGPT / Claude artifacts**: Those generate code but don't execute it in a real environment. We provide a full Linux VM with real tools.

The moat is: **hosted opencode + branching execution + collaboration**, all zero-setup.
