import * as Y from "yjs";
import type { ClientPresence } from "./types.js";

/**
 * DocumentProvider manages a shared Yjs document for collaborative editing
 * This runs on the server side (in the Worker) to coordinate multiple clients
 */

export class DocumentProvider {
  private doc: Y.Doc;
  private text: Y.Text;
  private awareness: Map<string, ClientPresence> = new Map();

  constructor(fileName: string) {
    this.doc = new Y.Doc();
    // Create a shared text type for the document
    this.text = this.doc.getText(fileName);
  }

  /**
   * Get the current document state as a Uint8Array (for syncing new clients)
   */
  getState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  /**
   * Apply an update from a client
   */
  applyUpdate(update: Uint8Array, userId: string): void {
    try {
      Y.applyUpdate(this.doc, update, userId);
    } catch (error) {
      console.error("Failed to apply update:", error);
    }
  }

  /**
   * Get the full text content
   */
  getText(): string {
    return this.text.toString();
  }

  /**
   * Update a client's presence (cursor position, etc.)
   */
  updatePresence(userId: string, presence: Partial<ClientPresence>): void {
    const existing = this.awareness.get(userId) || { userId };
    this.awareness.set(userId, {
      ...existing,
      ...presence,
      lastSeen: new Date().toISOString(),
    });
  }

  /**
   * Remove a client from the awareness map
   */
  removePresence(userId: string): void {
    this.awareness.delete(userId);
  }

  /**
   * Get all active client presences
   */
  getPresences(): ClientPresence[] {
    return Array.from(this.awareness.values());
  }

  /**
   * Subscribe to document updates
   */
  onUpdate(callback: (update: Uint8Array, origin: any) => void): () => void {
    const handler = (update: Uint8Array, origin: any) => {
      callback(update, origin);
    };
    this.doc.on("update", handler);

    // Return unsubscribe function
    return () => {
      this.doc.off("update", handler);
    };
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.doc.destroy();
    this.awareness.clear();
  }
}
