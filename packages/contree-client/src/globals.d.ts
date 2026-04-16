/**
 * Minimal type declarations for the Web/Workers fetch API and timers.
 * These are globally available in Cloudflare Workers, Deno, Bun, and
 * Node 18+ (with --experimental-fetch or natively in Node 21+).
 */

interface RequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
}

type BodyInit = string | ArrayBuffer | Uint8Array | ReadableStream;

interface ResponseInit {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
}

interface Response {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

declare function fetch(input: string, init?: RequestInit): Promise<Response>;
declare function setTimeout(
  callback: () => void,
  ms: number,
): ReturnType<typeof setTimeout>;
