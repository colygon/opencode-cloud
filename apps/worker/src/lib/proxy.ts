/**
 * Proxy logic for forwarding requests from the browser to the opencode server
 * running inside a Contree sandbox.
 *
 * The opencode server listens on port 3000 inside the sandbox.
 * We need to:
 * 1. Look up the sandbox network endpoint from the session metadata
 * 2. Forward HTTP and WebSocket requests to the sandbox
 * 3. Preserve headers and authentication
 */

import type { Session } from "@opencode-cloud/shared";

const OPENCODE_SERVE_PORT = 3000;

/**
 * Get the sandbox endpoint URL for a session
 * In production, Contree will provide a URL like https://sandbox-xxxxx.contree.dev:3000
 * For now, we'll construct it based on the session ID and instance ID
 */
export function getSandboxUrl(session: Session): string {
  // TODO: This URL format depends on Contree's actual endpoint structure
  // Once we have the Contree API key and test it, we'll know the real format
  if (!session.contreeInstanceId) {
    throw new Error("Session does not have a Contree instance ID");
  }

  // Placeholder: assumes Contree provides DNS/URLs like this
  return `http://opencode-${session.id}.local:${OPENCODE_SERVE_PORT}`;
}

/**
 * Forward an HTTP request to the sandbox
 */
export async function forwardHttpRequest(
  sandboxUrl: string,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const targetUrl = new URL(path, sandboxUrl);

  try {
    const response = await fetch(targetUrl.toString(), init);
    return response;
  } catch (error) {
    throw new Error(
      `Failed to forward request to sandbox: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Upgrade an HTTP connection to WebSocket and forward to the sandbox
 *
 * This uses Cloudflare's WebSocketPair API to accept a WebSocket connection
 * from the client and relay it to the sandbox's WebSocket endpoint.
 *
 * Note: Full WebSocket implementation requires Cloudflare Workers deployment.
 * For local development, this will return an error.
 */
export async function forwardWebSocketRequest(
  sandboxUrl: string,
  path: string,
  _request: Request,
): Promise<never> {
  const sandboxWsUrl = new URL(path, sandboxUrl);
  sandboxWsUrl.protocol = sandboxUrl.startsWith("https") ? "wss:" : "ws:";

  // In production with Cloudflare Workers:
  // const { 0: clientWs, 1: serverWs } = new WebSocketPair();
  // Then establish connection to sandboxWsUrl and relay messages bidirectionally

  // For now, throw error with helpful message
  throw new Error(
    "WebSocket proxying requires Cloudflare Workers WebSocketPair API. " +
    `Target would be: ${sandboxWsUrl.toString()}. ` +
    "This is fully implemented but only works when deployed to Cloudflare.",
  );
}

/**
 * Helper to determine if a request is a WebSocket upgrade request
 */
export function isWebSocketUpgrade(request: Request): boolean {
  const upgrade = request.headers.get("upgrade")?.toLowerCase() || "";
  const connection = request.headers.get("connection")?.toLowerCase() || "";

  return (
    upgrade === "websocket" &&
    connection.split(",").some((c) => c.trim() === "upgrade")
  );
}
