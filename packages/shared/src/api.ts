export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export interface PaginatedResponse<T> {
  items: T[];
  cursor?: string;
}
