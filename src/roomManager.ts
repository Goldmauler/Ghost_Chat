import * as vscode from 'vscode';
import {
  setLastActivity,
  roomExists,
  deleteRoom,
  getRoomLastActivity,
  firebasePut,
} from './firebase';
import { StatusBarManager } from './statusBar';
import {
  generateRoomId,
  generateRoomKey,
  makeInvite,
  parseInvite,
  keyToString,
  keyFromString,
  displayCode,
} from './crypto';

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const KEY_ACTIVE_ROOM = 'rezo.activeRoomCode';
const SECRET_ROOM_KEY_PREFIX = 'rezo.roomKey:';

// ---------------------------------------------------------------------------
// Room key storage (VS Code SecretStorage — never touches Firebase)
// ---------------------------------------------------------------------------

async function storeRoomKey(
  context: vscode.ExtensionContext,
  roomId: string,
  key: Buffer
): Promise<void> {
  await context.secrets.store(SECRET_ROOM_KEY_PREFIX + roomId, keyToString(key));
}

export async function getRoomKey(
  context: vscode.ExtensionContext,
  roomId: string
): Promise<Buffer | null> {
  const stored = await context.secrets.get(SECRET_ROOM_KEY_PREFIX + roomId);
  if (!stored) return null;
  return keyFromString(stored);
}

// ---------------------------------------------------------------------------
// Room expiry
// ---------------------------------------------------------------------------

function getRoomExpiryMs(): number {
  const setting = vscode.workspace
    .getConfiguration('rezo')
    .get<string>('roomExpiry', '24h');

  switch (setting) {
    case '5m':    return 5 * 60 * 1000;
    case '35m':   return 35 * 60 * 1000;
    case '1h':    return 60 * 60 * 1000;
    case '4h':    return 4 * 60 * 60 * 1000;
    case '24h':   return 24 * 60 * 60 * 1000;
    case '7d':    return 7 * 24 * 60 * 60 * 1000;
    case 'never': return Number.POSITIVE_INFINITY;
    default:      return 24 * 60 * 60 * 1000;
  }
}

// ---------------------------------------------------------------------------
// Room lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a new end-to-end-encrypted room. Generates an unguessable room id and
 * a 256-bit room key, stores the key locally, and surfaces a shareable invite.
 */
export async function createRoom(
  context: vscode.ExtensionContext,
  statusBar: StatusBarManager,
  outputChannel: vscode.OutputChannel
): Promise<{ roomId: string; key: Buffer } | null> {
  const roomId = generateRoomId();
  const key = generateRoomKey();
  outputChannel.appendLine(`[REZO] Creating room ${displayCode(roomId)}…`);

  try {
    await setLastActivity(roomId);
    // Store the creator's expiry so the server-side cleanup job knows when
    // this room is abandoned. -1 means "never".
    const expiryMs = getRoomExpiryMs();
    await firebasePut(`rooms/${roomId}/ttl`, Number.isFinite(expiryMs) ? expiryMs : -1);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`REZO: Failed to create room — ${msg}`);
    outputChannel.appendLine(`[REZO] createRoom error: ${msg}`);
    return null;
  }

  await storeRoomKey(context, roomId, key);
  await context.globalState.update(KEY_ACTIVE_ROOM, roomId);
  statusBar.update(roomId);

  const invite = makeInvite(roomId, key);
  outputChannel.appendLine(`[REZO] Room created: ${displayCode(roomId)}`);
  void vscode.window
    .showInformationMessage(
      'REZO: Encrypted room created. Share the invite with your team — it contains the decryption key, so send it privately.',
      'Copy Invite'
    )
    .then((choice) => {
      if (choice === 'Copy Invite') {
        void vscode.env.clipboard.writeText(invite);
        void vscode.window.showInformationMessage('REZO: Invite copied to clipboard.');
      }
    });

  return { roomId, key };
}

/**
 * Prompt for an invite string, validate the room exists, then join it.
 */
export async function joinRoom(
  context: vscode.ExtensionContext,
  statusBar: StatusBarManager,
  outputChannel: vscode.OutputChannel
): Promise<{ roomId: string; key: Buffer } | null> {
  const input = await vscode.window.showInputBox({
    prompt: 'Paste a REZO invite (REZO-XXXX…~key)',
    placeHolder: 'REZO-…~…',
    ignoreFocusOut: true,
    validateInput: (value) =>
      parseInvite(value) ? null : 'That does not look like a valid REZO invite.',
  });

  if (!input) return null;

  const parsed = parseInvite(input);
  if (!parsed) {
    vscode.window.showErrorMessage('REZO: Invalid invite.');
    return null;
  }
  const { roomId, key } = parsed;
  outputChannel.appendLine(`[REZO] Attempting to join ${displayCode(roomId)}…`);

  let exists: boolean;
  try {
    exists = await roomExists(roomId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`REZO: Network error — ${msg}`);
    outputChannel.appendLine(`[REZO] joinRoom network error: ${msg}`);
    return null;
  }

  if (!exists) {
    vscode.window.showErrorMessage(
      `REZO: Room ${displayCode(roomId)} not found or expired.`
    );
    return null;
  }

  const expired = await checkAndCleanupRoom(roomId, outputChannel);
  if (expired) {
    vscode.window.showWarningMessage('REZO: Room expired. Create or join another.');
    return null;
  }

  await storeRoomKey(context, roomId, key);
  await context.globalState.update(KEY_ACTIVE_ROOM, roomId);
  statusBar.update(roomId);
  outputChannel.appendLine(`[REZO] Joined ${displayCode(roomId)}`);
  vscode.window.showInformationMessage(`REZO: Joined ${displayCode(roomId)}`);
  return { roomId, key };
}

/**
 * Leave the current room — clears stored room + key reference and status bar.
 */
export async function leaveRoom(
  context: vscode.ExtensionContext,
  statusBar: StatusBarManager,
  outputChannel: vscode.OutputChannel
): Promise<void> {
  const current = getActiveRoom(context);
  await context.globalState.update(KEY_ACTIVE_ROOM, undefined);
  if (current) {
    // Forget the key so a lost/stolen machine can't decrypt scrollback.
    await context.secrets.delete(SECRET_ROOM_KEY_PREFIX + current);
  }
  statusBar.update(undefined);

  vscode.window.showInformationMessage(
    current ? `REZO: Left ${displayCode(current)}` : 'REZO: No active room to leave.'
  );
  outputChannel.appendLine(`[REZO] Left room: ${current ?? '(none)'}`);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export async function checkAndCleanupRoom(
  roomCode: string,
  outputChannel: vscode.OutputChannel
): Promise<boolean> {
  let lastActivity: number | null;
  try {
    lastActivity = await getRoomLastActivity(roomCode);
  } catch {
    outputChannel.appendLine(
      `[REZO] checkAndCleanupRoom: could not read lastActivity for ${displayCode(roomCode)}`
    );
    return false;
  }

  if (lastActivity === null) return true; // Room doesn't exist

  const expiryMs = getRoomExpiryMs();
  if (!Number.isFinite(expiryMs)) return false;

  const age = Date.now() - lastActivity;
  if (age > expiryMs) {
    outputChannel.appendLine(
      `[REZO] Room ${displayCode(roomCode)} expired (age ${Math.round(age / 60000)}m). Deleting…`
    );
    try {
      await deleteRoom(roomCode);
    } catch (err) {
      outputChannel.appendLine(`[REZO] Failed to delete expired room: ${err}`);
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Active room accessor
// ---------------------------------------------------------------------------

export function getActiveRoom(
  context: vscode.ExtensionContext
): string | undefined {
  return context.globalState.get<string>(KEY_ACTIVE_ROOM);
}

// ---------------------------------------------------------------------------
// One-time migration
// ---------------------------------------------------------------------------

/**
 * Before 3.1 the active room, display name, and message cache lived in
 * workspaceState, so opening another folder dropped you out of your room.
 * They now live in globalState; copy any old per-folder values across once.
 */
export async function migrateWorkspaceState(
  context: vscode.ExtensionContext
): Promise<void> {
  for (const key of [KEY_ACTIVE_ROOM, 'rezo.displayName', 'rezo.messageCache']) {
    const old = context.workspaceState.get(key);
    if (old !== undefined && context.globalState.get(key) === undefined) {
      await context.globalState.update(key, old);
    }
  }
}
