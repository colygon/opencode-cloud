/**
 * Collaboration types for multi-user document editing
 */

export interface DocumentState {
  sessionId: string;
  fileName: string;
  content: string;
  version: number;
  lastModified: string;
  modifiedBy: string;
}

export interface CollabMessage {
  type: "join" | "sync" | "update" | "cursor" | "leave";
  sessionId: string;
  userId: string;
  data: Record<string, unknown>;
}

export interface ClientPresence {
  userId: string;
  userName?: string;
  cursorLine?: number;
  cursorColumn?: number;
  color?: string;
  lastSeen: string;
}

export interface SyncMessage {
  type: "sync";
  fileState: Uint8Array; // Yjs document state snapshot
  clients: ClientPresence[];
}

export interface CursorMessage {
  type: "cursor";
  userId: string;
  line: number;
  column: number;
  color: string;
}

export interface UpdateMessage {
  type: "update";
  update: Uint8Array; // Yjs update
}
