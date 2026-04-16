export interface User {
  id: string;
  email: string;
  name?: string;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  userId: string;
  /** First 8 chars for display */
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
}
