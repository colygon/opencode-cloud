export type SessionStatus = "provisioning" | "running" | "paused" | "destroyed";

export interface Session {
  id: string;
  userId: string;
  status: SessionStatus;
  contreeInstanceId: string;
  /** Current snapshot ID */
  snapshotId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionRequest {
  /** Optional git repo to clone */
  repoUrl?: string;
  /** Custom Contree image */
  imageId?: string;
}

export interface CreateSessionResponse {
  session: Session;
  /** URL to access opencode web UI */
  webUrl: string;
}
