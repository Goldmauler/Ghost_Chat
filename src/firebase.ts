import * as https from 'https';
import * as http from 'http';
import * as vscode from 'vscode';
import { FIREBASE_CONFIG, FirebaseConfig } from './config';

export type { FirebaseConfig };

/**
 * Return Firebase config.
 * Prefers user-supplied settings (if any), otherwise uses the built-in config
 * so the extension works out of the box with zero configuration.
 */
export function getFirebaseConfig(): FirebaseConfig {
  const userConfig = vscode.workspace
    .getConfiguration('rezo')
    .get<FirebaseConfig>('firebaseConfig');

  if (userConfig && typeof userConfig === 'object' && userConfig.databaseURL) {
    return userConfig;
  }
  return FIREBASE_CONFIG;
}

/**
 * Return the database URL, always available via built-in config.
 */
export function getDatabaseUrl(): string {
  const config = getFirebaseConfig();
  return (config.databaseURL ?? '').replace(/\/$/, '');
}

// ---------------------------------------------------------------------------
// Low-level HTTP helpers
// ---------------------------------------------------------------------------

/**
 * Perform an HTTP/HTTPS request and return the parsed JSON response body.
 */
function request(
  method: string,
  url: string,
  body?: unknown,
  redirectsLeft = 3
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const lib: typeof https = isHttps ? https : (http as unknown as typeof https);

    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;

    const options: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port
        ? parseInt(parsedUrl.port, 10)
        : isHttps
        ? 443
        : 80,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = lib.request(options, (res) => {
      const status = res.statusCode ?? 0;

      // Follow Firebase regional-endpoint redirects so a 307 doesn't silently
      // return a null body that the caller mistakes for "no data."
      if ([301, 302, 307, 308].includes(status) && res.headers.location && redirectsLeft > 0) {
        res.resume(); // drain to free socket
        resolve(request(method, res.headers.location, body, redirectsLeft - 1));
        return;
      }

      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on('end', () => {
        if (status >= 400) {
          // Surface the real error so silent send/receive failures stop hiding.
          const snippet = data.slice(0, 200);
          reject(new Error(`Firebase ${method} ${parsedUrl.pathname} → HTTP ${status}: ${snippet}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          // Firebase DELETE / empty PUT return empty body; null is fine
          resolve(null);
        }
      });
    });

    req.on('error', (err: Error) => {
      reject(new Error(`REZO: Network error — ${err.message}`));
    });

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Firebase REST wrappers
// ---------------------------------------------------------------------------

/** GET a Firebase path and return the value (may be null). */
export async function firebaseGet(path: string): Promise<unknown> {
  const base = getDatabaseUrl();
  const url = `${base}/${path}.json`;
  return request('GET', url);
}

/** POST to a Firebase path (creates a new child with auto-ID). */
export async function firebasePost(
  path: string,
  data: unknown
): Promise<string | null> {
  const base = getDatabaseUrl();
  const url = `${base}/${path}.json`;
  const result = (await request('POST', url, data)) as { name?: string } | null;
  return result?.name ?? null;
}

/** PUT to a Firebase path (sets value). */
export async function firebasePut(
  path: string,
  data: unknown
): Promise<void> {
  const base = getDatabaseUrl();
  const url = `${base}/${path}.json`;
  await request('PUT', url, data);
}

/** DELETE a Firebase path. */
export async function firebaseDelete(path: string): Promise<void> {
  const base = getDatabaseUrl();
  const url = `${base}/${path}.json`;
  await request('DELETE', url);
}

// ---------------------------------------------------------------------------
// Room lifecycle operations
//
// Note: message send/fetch live in messageStore.ts because they encrypt the
// payload first. This module stays a thin, secret-free REST layer.
// ---------------------------------------------------------------------------

/**
 * Get the lastActivity timestamp for a room (null if room doesn't exist).
 */
export async function getRoomLastActivity(
  roomCode: string
): Promise<number | null> {
  const val = await firebaseGet(`rooms/${roomCode}/lastActivity`);
  if (typeof val === 'number') {
    return val;
  }
  return null;
}

/**
 * Delete an entire room from Firebase.
 */
export async function deleteRoom(roomCode: string): Promise<void> {
  await firebaseDelete(`rooms/${roomCode}`);
}

/**
 * Update lastActivity for a room to the current timestamp.
 */
export async function setLastActivity(roomCode: string): Promise<void> {
  await firebasePut(`rooms/${roomCode}/lastActivity`, Date.now());
}

/**
 * Check if a room exists by reading its lastActivity.
 * Returns true if the room has a lastActivity value (i.e. was created).
 */
export async function roomExists(roomCode: string): Promise<boolean> {
  const val = await getRoomLastActivity(roomCode);
  return val !== null;
}
