export interface ContreeImage {
  id: string;
  tags: string[];
  created_at: string;
}

export interface ImportImageRequest {
  reference: string;
}

export interface RunRequest {
  image_id: string;
  shell: string;
  stdin?: string;
  disposable?: boolean;
  timeout_seconds?: number;
}

export interface RunResult {
  image_id: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  operation_id: string;
}

export interface FileEntry {
  path: string;
  is_dir: boolean;
  size: number;
}

export interface Operation {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  result?: unknown;
}

export interface ContreeConfig {
  apiKey: string;
  baseUrl?: string;
}
