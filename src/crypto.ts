import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// End-to-end encryption for REZO.
//
// Threat model: the Firebase Realtime Database is reachable by anyone who
// knows a room path, and it holds no per-user authentication. So we never put
// readable data in it. Every sensitive field (message text, sender name, AI
// Q&A, vault contents) is encrypted client-side with AES-256-GCM before it is
// written, and decrypted only on machines that hold the room key.
//
// The room key is a 256-bit random value that is NEVER sent to Firebase. It
// travels only inside the invite string that a user shares out-of-band, and is
// stored locally in VS Code SecretStorage. An attacker dumping the database
// therefore sees only ciphertext plus routing metadata (timestamps, line
// numbers) that reveal nothing about what was said.
// ---------------------------------------------------------------------------

const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce
const TAG_BYTES = 16;

/** Path component identifying a room. 80 bits of entropy — unguessable. */
export function generateRoomId(): string {
  const raw = crypto.randomBytes(10).toString('hex').toUpperCase(); // 20 hex chars
  return `REZO-${raw}`;
}

/** Short, human-friendly label for status bar / UI. Not a secret. */
export function displayCode(roomId: string): string {
  const body = roomId.replace(/^REZO-/, '');
  return `REZO-${body.slice(0, 4)}`;
}

/** Fresh 256-bit room key. */
export function generateRoomKey(): Buffer {
  return crypto.randomBytes(KEY_BYTES);
}

export function keyToString(key: Buffer): string {
  return key.toString('base64url');
}

export function keyFromString(s: string): Buffer | null {
  try {
    const b = Buffer.from(s.trim(), 'base64url');
    return b.length === KEY_BYTES ? b : null;
  } catch {
    return null;
  }
}

/**
 * A shareable invite: `<roomId>~<base64url key>`. Everything a peer needs to
 * both address and decrypt the room. Treated as a secret — whoever holds it
 * can read the room.
 */
export function makeInvite(roomId: string, key: Buffer): string {
  return `${roomId}~${keyToString(key)}`;
}

export function parseInvite(
  invite: string
): { roomId: string; key: Buffer } | null {
  const t = invite.trim();
  const idx = t.indexOf('~');
  if (idx === -1) return null;
  const roomId = t.slice(0, idx).toUpperCase();
  const key = keyFromString(t.slice(idx + 1));
  if (!isRoomId(roomId) || !key) return null;
  return { roomId, key };
}

export function isRoomId(s: string): boolean {
  return /^REZO-[A-F0-9]{20}$/.test(s);
}

// --- payload encryption ----------------------------------------------------

/** Encrypt an arbitrary JSON-serializable value. Returns base64(iv|ct|tag). */
export function encryptJson(key: Buffer, obj: unknown): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const pt = Buffer.from(JSON.stringify(obj), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString('base64');
}

/**
 * Decrypt a value produced by encryptJson. Returns null on any failure —
 * wrong key, tampering, or malformed input — so callers can silently drop
 * ciphertext they cannot read (e.g. from an unrelated room).
 */
export function decryptJson<T = unknown>(key: Buffer, blob: string): T | null {
  try {
    const buf = Buffer.from(blob, 'base64');
    if (buf.length < IV_BYTES + TAG_BYTES) return null;
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(buf.length - TAG_BYTES);
    const ct = buf.subarray(IV_BYTES, buf.length - TAG_BYTES);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(pt.toString('utf8')) as T;
  } catch {
    return null;
  }
}
