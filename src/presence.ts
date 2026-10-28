import * as vscode from 'vscode';
import { firebasePut, firebaseDelete } from './firebase';
import { SSESubscription } from './sse';
import { PRESENCE_HEARTBEAT_MS, PRESENCE_STALE_MS } from './config';
import { encryptJson, decryptJson } from './crypto';

// ---------------------------------------------------------------------------
// Presence — light "who else is in this room right now".
//
// Path: rooms/{roomCode}/presence/{uid}
//   { name: string, lastSeen: number }
//
// Each client posts its own record every PRESENCE_HEARTBEAT_MS and subscribes
// to the same path via SSE so it sees other clients' heartbeats. Records
// older than PRESENCE_STALE_MS are considered offline. On leave/deactivate
// we delete our own record so peers see us drop instantly.
// ---------------------------------------------------------------------------

export interface PresenceRecord {
  name: string;
  lastSeen: number;
}

/** What actually lands in Firebase — the name is encrypted. */
interface PresenceEnvelope {
  lastSeen: number;
  ct: string;
}

export type PresenceListener = (onlineCount: number, names: string[]) => void;

/**
 * Stable per-install id. Workspace state would be too coarse (resets per
 * folder), globalState is per-machine which is what we want.
 */
function getOrCreateUid(context: vscode.ExtensionContext): string {
  const key = 'rezo.presenceUid';
  const existing = context.globalState.get<string>(key);
  if (existing) return existing;
  const uid =
    `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  void context.globalState.update(key, uid);
  return uid;
}

export class PresenceManager {
  private readonly uid: string;
  private roomCode: string | undefined;
  private key: Buffer | undefined;
  private sse: SSESubscription | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private records: Map<string, PresenceRecord> = new Map();
  private readonly listeners = new Set<PresenceListener>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly nameProvider: () => string,
    private readonly logger: vscode.OutputChannel
  ) {
    this.uid = getOrCreateUid(context);
  }

  public onChange(listener: PresenceListener): vscode.Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  public start(roomCode: string, key: Buffer): void {
    if (this.roomCode === roomCode) return;
    this.stop();
    this.roomCode = roomCode;
    this.key = key;
    this.logger.appendLine(`[REZO Presence] joining as ${this.uid}`);

    // Subscribe first so we see our own heartbeat round-trip.
    this.sse = new SSESubscription(
      `rooms/${roomCode}/presence`,
      (msg) => this.handleEvent(msg.path, msg.data),
      (err) => this.logger.appendLine(`[REZO Presence] SSE error: ${err.message}`)
    );
    this.sse.start();

    // Post immediately, then on an interval.
    void this.heartbeat();
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), PRESENCE_HEARTBEAT_MS);
  }

  public stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.sse) {
      this.sse.stop();
      this.sse = undefined;
    }
    if (this.roomCode) {
      // Best-effort cleanup so peers see us drop immediately.
      const room = this.roomCode;
      const uid = this.uid;
      void firebaseDelete(`rooms/${room}/presence/${uid}`).catch(() => undefined);
    }
    this.roomCode = undefined;
    this.key = undefined;
    this.records.clear();
    this.notify();
  }

  public dispose(): void {
    this.stop();
  }

  private async heartbeat(): Promise<void> {
    if (!this.roomCode || !this.key) return;
    try {
      await firebasePut(`rooms/${this.roomCode}/presence/${this.uid}`, {
        lastSeen: Date.now(),
        ct: encryptJson(this.key, { name: this.nameProvider() })
      } satisfies PresenceEnvelope);
    } catch (err) {
      // Network blip — next tick will retry.
      this.logger.appendLine(
        `[REZO Presence] heartbeat failed: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  /**
   * SSE event handler. Firebase RTDB emits:
   *   path "/"           with full snapshot (initial connect)
   *   path "/{uid}"      with record (added/changed) or null (removed)
   */
  private handleEvent(path: string, data: unknown): void {
    if (path === '/') {
      this.records.clear();
      if (data && typeof data === 'object') {
        for (const [uid, raw] of Object.entries(data as Record<string, unknown>)) {
          const rec = this.coerce(raw);
          if (rec) this.records.set(uid, rec);
        }
      }
    } else {
      const uid = path.replace(/^\//, '');
      if (data === null) {
        this.records.delete(uid);
      } else {
        const rec = this.coerce(data);
        if (rec) this.records.set(uid, rec);
        else this.records.delete(uid);
      }
    }
    this.notify();
  }

  private coerce(raw: unknown): PresenceRecord | null {
    if (!raw || typeof raw !== 'object' || !this.key) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.lastSeen !== 'number' || typeof r.ct !== 'string') return null;
    const inner = decryptJson<{ name?: string }>(this.key, r.ct);
    if (!inner || typeof inner.name !== 'string') return null;
    return { name: inner.name, lastSeen: r.lastSeen };
  }

  private notify(): void {
    const now = Date.now();
    const live: string[] = [];
    for (const [uid, rec] of this.records) {
      if (now - rec.lastSeen <= PRESENCE_STALE_MS) {
        live.push(rec.name);
      } else {
        // Lazily prune so the map doesn't grow forever.
        this.records.delete(uid);
      }
    }
    live.sort((a, b) => a.localeCompare(b));
    for (const l of this.listeners) {
      try { l(live.length, live); }
      catch (e) {
        this.logger.appendLine(
          `[REZO Presence] listener error: ${e instanceof Error ? e.message : e}`
        );
      }
    }
  }
}
