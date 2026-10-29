import * as vscode from 'vscode';
import * as os from 'os';
import {
  firebaseGet,
  firebasePost,
  setLastActivity,
} from './firebase';
import { encryptJson, decryptJson } from './crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GhostMessage {
  id: string;
  roomCode: string;
  sender: string;
  content: string;
  /** Optional: pinned file basename (comment-thread messages only). */
  file?: string;
  /** Optional: 1-based line the message is pinned to. */
  line?: number;
  timestamp: number;
  /** Optional: commit SHA the sender was on when the message was sent. */
  commit?: string;
  /** Optional: short commit SHA for display (first 7 chars). */
  commitShort?: string;
  /** Optional: branch name. */
  branch?: string;
  /** Optional: was the working tree dirty at send time? */
  dirty?: boolean;
  /** Optional: reply chain — points to the parent message id. */
  replyTo?: string;
}

/**
 * What actually lands in Firebase. Only routing metadata is plaintext; the
 * human-readable payload (sender, content, git context) is encrypted into
 * `ct` with the room key so the open database stores no readable data.
 */
export interface MessageEnvelope {
  v: number;
  id: string;
  timestamp: number;
  file?: string;
  line?: number;
  replyTo?: string;
  ct: string;
}

const ENVELOPE_VERSION = 3;

/** Comment delimiters keyed by language ID */
interface CommentStyle {
  linePrefix: string;
  blockStart: string;
  blockEnd: string;
  useBlock: boolean;
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const KEY_DISPLAY_NAME = 'rezo.displayName';
const KEY_MESSAGE_CACHE = 'rezo.messageCache';
const MAX_CACHE_SIZE = 50;

// ---------------------------------------------------------------------------
// Display name
// ---------------------------------------------------------------------------

/**
 * Return the stored display name, or fall back to the OS username.
 */
export function getSenderName(context: vscode.ExtensionContext): string {
  const stored = context.globalState.get<string>(KEY_DISPLAY_NAME);
  if (stored && stored.trim().length > 0) {
    return stored.trim();
  }
  return os.userInfo().username || 'user';
}

/**
 * Persist a new display name.
 */
export async function setDisplayName(
  context: vscode.ExtensionContext,
  name: string
): Promise<void> {
  await context.globalState.update(KEY_DISPLAY_NAME, name.trim());
}

// ---------------------------------------------------------------------------
// Encrypted send / fetch
// ---------------------------------------------------------------------------

/** Encrypt the sensitive half of a message into a Firebase envelope. */
export function packMessage(msg: GhostMessage, key: Buffer): MessageEnvelope {
  const ct = encryptJson(key, {
    sender: msg.sender,
    content: msg.content,
    commit: msg.commit,
    commitShort: msg.commitShort,
    branch: msg.branch,
    dirty: msg.dirty,
  });
  return {
    v: ENVELOPE_VERSION,
    id: msg.id,
    timestamp: msg.timestamp,
    ...(msg.file ? { file: msg.file } : {}),
    ...(typeof msg.line === 'number' ? { line: msg.line } : {}),
    ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
    ct,
  };
}

/** Reverse of packMessage. Returns null if the ciphertext can't be read. */
export function unpackMessage(
  roomCode: string,
  env: MessageEnvelope,
  key: Buffer
): GhostMessage | null {
  if (!env || typeof env !== 'object' || typeof env.ct !== 'string') return null;
  const inner = decryptJson<{
    sender?: string;
    content?: string;
    commit?: string;
    commitShort?: string;
    branch?: string;
    dirty?: boolean;
  }>(key, env.ct);
  if (!inner || typeof inner.content !== 'string') return null;

  return {
    id: env.id,
    roomCode,
    sender: inner.sender || 'unknown',
    content: inner.content,
    file: env.file,
    line: env.line,
    timestamp: env.timestamp,
    commit: inner.commit,
    commitShort: inner.commitShort,
    branch: inner.branch,
    dirty: inner.dirty,
    replyTo: env.replyTo,
  };
}

/** Encrypt and post a message, then bump the room's lastActivity. */
export async function sendRoomMessage(
  msg: GhostMessage,
  key: Buffer
): Promise<void> {
  await firebasePost(`rooms/${msg.roomCode}/messages`, packMessage(msg, key));
  await setLastActivity(msg.roomCode);
}

/** Fetch and decrypt all messages for a room, sorted oldest first. */
export async function fetchRoomMessages(
  roomCode: string,
  key: Buffer
): Promise<GhostMessage[]> {
  const raw = (await firebaseGet(`rooms/${roomCode}/messages`)) as Record<
    string,
    MessageEnvelope
  > | null;

  if (!raw || typeof raw !== 'object') return [];

  const messages: GhostMessage[] = [];
  for (const env of Object.values(raw)) {
    if (!env || typeof env.timestamp !== 'number') continue;
    const msg = unpackMessage(roomCode, env, key);
    if (msg) messages.push(msg);
  }

  messages.sort((a, b) => a.timestamp - b.timestamp);
  return messages;
}

// ---------------------------------------------------------------------------
// Local message cache
// ---------------------------------------------------------------------------

type CacheStore = Record<string, GhostMessage[]>;

export async function cacheMessages(
  context: vscode.ExtensionContext,
  roomCode: string,
  messages: GhostMessage[]
): Promise<void> {
  const cache = context.globalState.get<CacheStore>(KEY_MESSAGE_CACHE) ?? {};
  cache[roomCode] = messages.slice(-MAX_CACHE_SIZE);
  await context.globalState.update(KEY_MESSAGE_CACHE, cache);
}

export function getCachedMessages(
  context: vscode.ExtensionContext,
  roomCode: string
): GhostMessage[] {
  const cache = context.globalState.get<CacheStore>(KEY_MESSAGE_CACHE) ?? {};
  return cache[roomCode] ?? [];
}

// ---------------------------------------------------------------------------
// Comment style detection + safe insertion
// ---------------------------------------------------------------------------

/**
 * Return the appropriate comment style for a given VS Code language ID.
 */
export function getCommentStyle(languageId: string): CommentStyle {
  const hashComment = [
    'python', 'ruby', 'shellscript', 'bash', 'sh', 'powershell', 'yaml',
    'toml', 'dockerfile', 'makefile', 'perl', 'r', 'coffeescript', 'elixir',
    'julia', 'crystal',
  ];
  const htmlComment = [
    'html', 'xml', 'svg', 'markdown', 'vue', 'htmldjango', 'handlebars',
  ];
  const dashComment = ['sql', 'lua', 'haskell'];
  const percentComment = ['latex', 'erlang', 'tex'];

  if (hashComment.includes(languageId)) {
    return { linePrefix: '# ', blockStart: '# ', blockEnd: '', useBlock: false };
  }
  if (htmlComment.includes(languageId)) {
    return { linePrefix: '', blockStart: '<!-- ', blockEnd: ' -->', useBlock: true };
  }
  if (dashComment.includes(languageId)) {
    return { linePrefix: '-- ', blockStart: '-- ', blockEnd: '', useBlock: false };
  }
  if (percentComment.includes(languageId)) {
    return { linePrefix: '% ', blockStart: '% ', blockEnd: '', useBlock: false };
  }
  // Default: C-style // line comments.
  return { linePrefix: '// ', blockStart: '// ', blockEnd: '', useBlock: false };
}

/**
 * Neutralize comment-terminator sequences so text inserted into a source file
 * cannot break out of its comment. Prevents the block-comment breakout where a
 * stray HTML or C block terminator inside remote/AI content would end the
 * comment early and turn the remainder into live markup or code. The
 * zero-width space keeps the text visually identical.
 */
export function sanitizeCommentContent(text: string): string {
  const zw = String.fromCharCode(0x200b); // zero-width space; breaks terminator, stays invisible
  return text
    .replace(/-->/g, '--' + zw + '>')
    .replace(/\*\//g, '*' + zw + '/');
}

/**
 * Build a REZO comment block from a body of text, escaping terminators.
 * Used to insert AI answers at the cursor without mutating them into code.
 */
export function buildCommentBlock(body: string, languageId: string): string {
  const style = getCommentStyle(languageId);

  function wrap(line: string): string {
    const safe = sanitizeCommentContent(line);
    if (style.useBlock) {
      return style.blockStart + safe + style.blockEnd;
    }
    return style.linePrefix + safe;
  }

  const out: string[] = [];
  out.push(wrap('===== REZO ====='));
  for (const line of body.split('\n')) {
    out.push(wrap(line));
  }
  out.push(wrap('================'));
  return out.join('\n') + '\n';
}
