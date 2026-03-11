'use client';

/**
 * Singleton Socket.io connection manager.
 *
 * Maintains a single socket per server URL and reference-counts arena subscriptions.
 * This prevents multiple components from opening redundant connections and ensures
 * that room membership is restored on reconnect.
 *
 * Design goals:
 * - One TCP connection shared across all useArenaSocket() hooks on the page
 * - Zero duplicate join:arena calls per room
 * - Automatic rejoin after reconnection
 * - Clean disconnect when all subscribers leave
 */

import { io, Socket } from 'socket.io-client';

type RoomListener = (event: string, data: unknown) => void;

interface RoomEntry {
  refCount: number;
  listeners: Set<RoomListener>;
}

class SocketManager {
  private socket: Socket | null = null;
  private url: string = '';
  private rooms = new Map<string, RoomEntry>();
  private globalListeners = new Set<RoomListener>();

  connect(url: string): Socket {
    if (this.socket && this.url === url && this.socket.connected) {
      return this.socket;
    }
    if (this.socket && this.url !== url) {
      // URL changed — full reset
      this.socket.disconnect();
      this.socket = null;
      this.rooms.clear();
    }
    if (!this.socket) {
      this.url = url;
      this.socket = io(url, {
        transports: ['websocket'],
        reconnectionDelayMax: 5000,
        reconnectionAttempts: Infinity,
        // Send timestamps for latency measurement
        auth: { clientTime: Date.now() },
      });

      this.socket.on('connect', () => {
        // Rejoin all tracked rooms after reconnection
        for (const arenaId of this.rooms.keys()) {
          this.socket!.emit('join:arena', arenaId);
        }
      });

      // Fan-out all events to room listeners
      this.socket.onAny((event: string, data: unknown) => {
        for (const listener of this.globalListeners) {
          listener(event, data);
        }
      });
    }
    return this.socket;
  }

  joinArena(arenaId: string, listener: RoomListener): void {
    if (!this.socket) return;

    let entry = this.rooms.get(arenaId);
    if (!entry) {
      entry = { refCount: 0, listeners: new Set() };
      this.rooms.set(arenaId, entry);
      this.socket.emit('join:arena', arenaId);
    }
    entry.refCount++;
    entry.listeners.add(listener);
    this.globalListeners.add(listener);
  }

  leaveArena(arenaId: string, listener: RoomListener): void {
    const entry = this.rooms.get(arenaId);
    if (!entry) return;

    entry.listeners.delete(listener);
    this.globalListeners.delete(listener);
    entry.refCount--;

    if (entry.refCount <= 0) {
      this.rooms.delete(arenaId);
      this.socket?.emit('leave:arena', arenaId);
    }

    // Auto-disconnect when no rooms remain
    if (this.rooms.size === 0 && this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  getSocket(): Socket | null {
    return this.socket;
  }
}

// Module-level singleton (safe for client-side; SSR guard in hooks)
export const socketManager = new SocketManager();
