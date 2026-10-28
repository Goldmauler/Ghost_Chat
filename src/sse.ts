import * as https from 'https';
import * as http from 'http';
import { getDatabaseUrl } from './firebase';

// ---------------------------------------------------------------------------
// Firebase Realtime Database Server-Sent Events subscription
// Replaces polling — true real-time updates, ~90% fewer requests
// ---------------------------------------------------------------------------
//
// Firebase RTDB exposes a streaming endpoint:
//   GET https://{db}/path.json?accept=text/event-stream
//
// Returns SSE stream with events:
//   event: put
//   data: {"path": "/key", "data": {...}}
//
//   event: patch
//   data: {"path": "/key", "data": {...}}
//
//   event: keep-alive
//   data: null
// ---------------------------------------------------------------------------

export interface SSEMessage {
  eventName: string;
  path: string;
  data: unknown;
}

export class SSESubscription {
  private req: http.ClientRequest | undefined;
  private buffer = '';
  private stopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryCount = 0;

  constructor(
    private readonly path: string,           // e.g. "rooms/REZO-7K9P/messages"
    private readonly onMessage: (msg: SSEMessage) => void,
    private readonly onError?: (err: Error) => void
  ) {}

  /**
   * Start the SSE subscription. Auto-reconnects on failure.
   */
  public start(): void {
    if (this.stopped) return;
    this.connect();
  }

  /**
   * Stop the subscription and prevent reconnects.
   */
  public stop(): void {
    this.stopped = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    if (this.req) {
      try { this.req.destroy(); } catch { /* ignore */ }
      this.req = undefined;
    }
  }

  private connect(): void {
    if (this.stopped) return;

    const base = getDatabaseUrl();
    const url = new URL(`${base}/${this.path}.json`);

    const options: https.RequestOptions = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache'
      }
    };

    this.req = https.request(options, (res) => {
      // Handle redirects (Firebase sometimes redirects to a regional endpoint)
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        const location = res.headers.location;
        if (location) {
          this.followRedirect(location);
          return;
        }
      }

      if (res.statusCode !== 200) {
        this.handleError(new Error(`SSE failed with status ${res.statusCode}`));
        return;
      }

      this.retryCount = 0; // Reset retry count on successful connect
      this.buffer = '';

      res.setEncoding('utf8');
      res.on('data', (chunk: string) => this.processChunk(chunk));
      res.on('end', () => this.handleDisconnect());
      res.on('error', (err) => this.handleError(err));
    });

    this.req.on('error', (err: Error) => this.handleError(err));
    this.req.end();
  }

  private followRedirect(redirectUrl: string): void {
    if (this.stopped) return;

    const url = new URL(redirectUrl);
    const options: https.RequestOptions = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache'
      }
    };

    this.req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        this.handleError(new Error(`SSE redirect failed: ${res.statusCode}`));
        return;
      }

      this.retryCount = 0;
      this.buffer = '';

      res.setEncoding('utf8');
      res.on('data', (chunk: string) => this.processChunk(chunk));
      res.on('end', () => this.handleDisconnect());
      res.on('error', (err) => this.handleError(err));
    });

    this.req.on('error', (err: Error) => this.handleError(err));
    this.req.end();
  }

  /**
   * Parse SSE chunks. Events are separated by blank lines.
   * Each event has lines like: "event: put" and "data: {...}"
   */
  private processChunk(chunk: string): void {
    this.buffer += chunk;

    // Split on double newline (event delimiter)
    const blocks = this.buffer.split(/\r?\n\r?\n/);
    this.buffer = blocks.pop() ?? ''; // Keep incomplete event for next chunk

    for (const block of blocks) {
      this.parseBlock(block);
    }
  }

  private parseBlock(block: string): void {
    let eventName = '';
    let dataStr = '';

    for (const rawLine of block.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataStr = line.slice(5).trim();
      }
    }

    if (!eventName || !dataStr) return;

    // Skip keep-alives — they just keep the connection open
    if (eventName === 'keep-alive' || eventName === 'cancel') return;

    try {
      const parsed = JSON.parse(dataStr) as { path?: string; data?: unknown } | null;
      if (!parsed || typeof parsed !== 'object') return;

      this.onMessage({
        eventName,
        path: parsed.path ?? '/',
        data: parsed.data ?? null
      });
    } catch {
      // Malformed event — ignore
    }
  }

  private handleDisconnect(): void {
    if (this.stopped) return;
    this.scheduleRetry();
  }

  private handleError(err: Error): void {
    if (this.stopped) return;
    this.onError?.(err);
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    this.retryCount++;
    // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
    const delay = Math.min(1000 * Math.pow(2, this.retryCount - 1), 30000);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }
}
