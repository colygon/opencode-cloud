import * as Y from "yjs";
import { DocumentProvider } from "./provider.js";
import type { CollabMessage, SyncMessage, UpdateMessage, CursorMessage } from "./types.js";

/**
 * CollaborationServer manages document sharing for a session
 * It handles:
 * - Client connections/disconnections
 * - Document state synchronization
 * - Update broadcasting
 * - Presence (cursor positions, etc.)
 */

interface ConnectedClient {
  userId: string;
  userName?: string;
  lastSeen: string;
}

export class CollaborationServer {
  private sessionId: string;
  private documents: Map<string, DocumentProvider> = new Map();
  private connectedClients: Map<string, ConnectedClient> = new Map();
  private listeners: ((message: CollabMessage) => void)[] = [];

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /**
   * Register a listener to receive messages from clients
   * (In a real implementation, this would be a WebSocket message handler)
   */
  onMessage(callback: (message: CollabMessage) => void): void {
    this.listeners.push(callback);
  }

  /**
   * Handle a message from a client
   */
  handleClientMessage(message: CollabMessage): void {
    try {
      switch (message.type) {
        case "join":
          this.handleClientJoin(message);
          break;
        case "sync":
          this.handleClientSync(message);
          break;
        case "update":
          this.handleClientUpdate(message);
          break;
        case "cursor":
          this.handleCursorUpdate(message);
          break;
        case "leave":
          this.handleClientLeave(message);
          break;
      }
    } catch (error) {
      console.error("Error handling client message:", error);
    }
  }

  /**
   * Handle client join
   */
  private handleClientJoin(message: CollabMessage): void {
    const { userId } = message;
    const { userName } = message.data as { userName?: string };

    // Register client
    this.connectedClients.set(userId, {
      userId,
      userName,
      lastSeen: new Date().toISOString(),
    });

    // Broadcast join to all clients
    this.broadcast({
      type: "join",
      sessionId: this.sessionId,
      userId,
      data: { clients: Array.from(this.connectedClients.values()) },
    });
  }

  /**
   * Handle client disconnect
   */
  private handleClientLeave(message: CollabMessage): void {
    const { userId } = message;
    this.connectedClients.delete(userId);

    // Remove presence
    for (const doc of this.documents.values()) {
      doc.removePresence(userId);
    }

    // Broadcast leave to all clients
    this.broadcast({
      type: "leave",
      sessionId: this.sessionId,
      userId,
      data: { clients: Array.from(this.connectedClients.values()) },
    });
  }

  /**
   * Handle sync request (new client joining)
   * Send full document state
   */
  private handleClientSync(message: CollabMessage): void {
    const { userId } = message;
    const { fileName } = message.data as { fileName: string };

    // Get or create document
    let doc = this.documents.get(fileName);
    if (!doc) {
      doc = new DocumentProvider(fileName);
      this.documents.set(fileName, doc);

      // Listen for updates to this document
      doc.onUpdate((update, origin) => {
        // Don't broadcast the update back to its origin
        if (origin !== userId) {
          this.broadcast({
            type: "update",
            sessionId: this.sessionId,
            userId: origin,
            data: { update: Array.from(update), fileName },
          });
        }
      });
    }

    // Send initial state and presence to the requesting client
    const syncMessage: SyncMessage = {
      type: "sync",
      fileState: doc.getState(),
      clients: doc.getPresences(),
    };

    // This would be sent directly to the requesting client
    // In the WebSocket implementation, we'd queue this for that specific client
  }

  /**
   * Handle document update from client
   */
  private handleClientUpdate(message: CollabMessage): void {
    const { userId } = message;
    const { fileName, update } = message.data as { fileName: string; update: number[] };

    const doc = this.documents.get(fileName);
    if (doc) {
      doc.applyUpdate(new Uint8Array(update), userId);
    }
  }

  /**
   * Handle cursor/presence update
   */
  private handleCursorUpdate(message: CollabMessage): void {
    const { userId } = message;
    const { fileName, line, column, color } = message.data as {
      fileName: string;
      line: number;
      column: number;
      color: string;
    };

    const doc = this.documents.get(fileName);
    if (doc) {
      doc.updatePresence(userId, {
        userId,
        cursorLine: line,
        cursorColumn: column,
        color,
      });

      // Broadcast presence update
      this.broadcast({
        type: "cursor",
        sessionId: this.sessionId,
        userId,
        data: { line, column, color, fileName },
      });
    }
  }

  /**
   * Broadcast a message to all connected clients
   */
  private broadcast(message: CollabMessage): void {
    for (const listener of this.listeners) {
      try {
        listener(message);
      } catch (error) {
        console.error("Error in message listener:", error);
      }
    }
  }

  /**
   * Get all connected clients
   */
  getConnectedClients(): ConnectedClient[] {
    return Array.from(this.connectedClients.values());
  }

  /**
   * Get a specific document
   */
  getDocument(fileName: string): DocumentProvider | undefined {
    return this.documents.get(fileName);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    for (const doc of this.documents.values()) {
      doc.destroy();
    }
    this.documents.clear();
    this.connectedClients.clear();
    this.listeners = [];
  }
}
