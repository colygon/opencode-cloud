import type {
  ContreeConfig,
  ContreeImage,
  FileEntry,
  Operation,
  RunRequest,
  RunResult,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.contree.dev";
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_WAIT_TIMEOUT_MS = 300_000;

export class ContreeError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ContreeError";
  }
}

export class ContreeClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ContreeConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    opts?: { body?: unknown; rawResponse?: false },
  ): Promise<T>;
  private async request(
    method: string,
    path: string,
    opts: { rawResponse: true; body?: unknown },
  ): Promise<Response>;
  private async request<T>(
    method: string,
    path: string,
    opts?: { body?: unknown; rawResponse?: boolean },
  ): Promise<T | Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };

    let reqBody: BodyInit | undefined;
    if (opts?.body instanceof Uint8Array) {
      headers["Content-Type"] = "application/octet-stream";
      reqBody = opts.body;
    } else if (opts?.body !== undefined) {
      headers["Content-Type"] = "application/json";
      reqBody = JSON.stringify(opts.body);
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: reqBody,
    });

    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = await res.text().catch(() => undefined);
      }
      throw new ContreeError(
        `Contree API ${method} ${path} returned ${res.status}`,
        res.status,
        body,
      );
    }

    if (opts?.rawResponse) return res;
    return (await res.json()) as T;
  }

  // ---------------------------------------------------------------------------
  // Images
  // ---------------------------------------------------------------------------

  /** Import an OCI image (e.g. "ubuntu:22.04"). Returns an async operation. */
  async importImage(reference: string): Promise<Operation> {
    return this.request<Operation>("POST", "/images/import", {
      body: { reference },
    });
  }

  /** Get an image by ID. */
  async getImage(id: string): Promise<ContreeImage> {
    return this.request<ContreeImage>("GET", `/images/${id}`);
  }

  /** List all images. */
  async listImages(): Promise<ContreeImage[]> {
    return this.request<ContreeImage[]>("GET", "/images");
  }

  /** Tag an image. */
  async setTag(imageId: string, tag: string): Promise<void> {
    await this.request<unknown>("POST", `/images/${imageId}/tags`, {
      body: { tag },
    });
  }

  // ---------------------------------------------------------------------------
  // Sandbox execution
  // ---------------------------------------------------------------------------

  /**
   * Run a command in a sandbox. By default this polls the resulting operation
   * until it completes and returns the full result.
   */
  async run(req: RunRequest): Promise<RunResult> {
    const op = await this.request<Operation>("POST", "/run", { body: req });
    const completed = await this.waitOperation(op.id);
    return completed.result as RunResult;
  }

  // ---------------------------------------------------------------------------
  // File operations
  // ---------------------------------------------------------------------------

  /** Upload a file into an image at the given path. */
  async upload(
    imageId: string,
    path: string,
    content: Uint8Array,
  ): Promise<void> {
    const encodedPath = encodeURIComponent(path);
    await this.request<unknown>(
      "PUT",
      `/images/${imageId}/files?path=${encodedPath}`,
      { body: content },
    );
  }

  /** Download a file from an image. */
  async download(imageId: string, path: string): Promise<Uint8Array> {
    const encodedPath = encodeURIComponent(path);
    const res = await this.request(
      "GET",
      `/images/${imageId}/files?path=${encodedPath}`,
      { rawResponse: true },
    );
    return new Uint8Array(await res.arrayBuffer());
  }

  /** List files in a directory within an image. */
  async listFiles(imageId: string, path: string): Promise<FileEntry[]> {
    const encodedPath = encodeURIComponent(path);
    return this.request<FileEntry[]>(
      "GET",
      `/images/${imageId}/files/list?path=${encodedPath}`,
    );
  }

  /** Read a file as text from an image. */
  async readFile(imageId: string, path: string): Promise<string> {
    const encodedPath = encodeURIComponent(path);
    const res = await this.request(
      "GET",
      `/images/${imageId}/files/read?path=${encodedPath}`,
      { rawResponse: true },
    );
    return res.text();
  }

  // ---------------------------------------------------------------------------
  // Operations
  // ---------------------------------------------------------------------------

  /** Get the current status of an operation. */
  async getOperation(id: string): Promise<Operation> {
    return this.request<Operation>("GET", `/operations/${id}`);
  }

  /**
   * Poll an operation until it reaches a terminal state (completed, failed, or
   * cancelled). Throws if the timeout is exceeded.
   */
  async waitOperation(
    id: string,
    timeoutMs: number = DEFAULT_WAIT_TIMEOUT_MS,
  ): Promise<Operation> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const op = await this.getOperation(id);

      if (op.status === "completed" || op.status === "failed" || op.status === "cancelled") {
        return op;
      }

      await new Promise<void>((resolve) =>
        setTimeout(() => resolve(), DEFAULT_POLL_INTERVAL_MS),
      );
    }

    throw new Error(
      `Operation ${id} did not complete within ${timeoutMs}ms`,
    );
  }
}
