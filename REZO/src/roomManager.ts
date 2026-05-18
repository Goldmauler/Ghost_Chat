import * as vscode from 'vscode';
import {
  setLastActivity,
  roomExists,
  deleteRoom,
  getRoomLastActivity,
} from './firebase';
import { StatusBarManager } from './statusBar';

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const KEY_ACTIVE_ROOM = 'rezo.activeRoomCode';

// Room expiry: 35 minutes in milliseconds
const ROOM_EXPIRY_MS = 35 * 60 * 1000;

// ---------------------------------------------------------------------------
// Room code generation
// ---------------------------------------------------------------------------

/**
 * Generate a room code like REZO-7K9P (4 uppercase alphanumeric chars).
 */
export function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `REZO-${suffix}`;
}

// ---------------------------------------------------------------------------
// Room lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a new room, store it in workspaceState, and update the status bar.
 */
export async function createRoom(
  context: vscode.ExtensionContext,
  statusBar: StatusBarManager,
  outputChannel: vscode.OutputChannel
): Promise<void> {
  const roomCode = generateRoomCode();
  outputChannel.appendLine(`[REZO] Creating room ${roomCode}…`);

  try {
    await setLastActivity(roomCode);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`REZO: Failed to create room — ${msg}`);
    outputChannel.appendLine(`[REZO] createRoom error: ${msg}`);
    return;
  }

  await context.workspaceState.update(KEY_ACTIVE_ROOM, roomCode);
  statusBar.update(roomCode);

  outputChannel.appendLine(`[REZO] Room created: ${roomCode}`);
  vscode.window.showInformationMessage(
    `REZO: Room created! Share this code with your team: ${roomCode}`,
    'Copy Code'
  ).then((choice) => {
    if (choice === 'Copy Code') {
      vscode.env.clipboard.writeText(roomCode);
      vscode.window.showInformationMessage('REZO: Room code copied to clipboard.');
    }
  });
}

/**
 * Prompt the user to enter a room code, validate it exists, check for expiry,
 * then join it.
 */
export async function joinRoom(
  context: vscode.ExtensionContext,
  statusBar: StatusBarManager,
  outputChannel: vscode.OutputChannel
): Promise<void> {
  const input = await vscode.window.showInputBox({
    prompt: 'Enter REZO room code (e.g. REZO-7K9P)',
    placeHolder: 'REZO-XXXX',
    validateInput: (value) => {
      if (!/^REZO-[A-Z0-9]{4}$/.test(value.toUpperCase().trim())) {
        return 'Room code must be in the format REZO-XXXX (4 uppercase letters/numbers)';
      }
      return null;
    },
  });

  if (!input) {
    return; // User cancelled
  }

  const roomCode = input.toUpperCase().trim();
  outputChannel.appendLine(`[REZO] Attempting to join room ${roomCode}…`);

  // Check if room exists
  let exists: boolean;
  try {
    exists = await roomExists(roomCode);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`REZO: Network error — ${msg}`);
    outputChannel.appendLine(`[REZO] joinRoom network error: ${msg}`);
    return;
  }

  if (!exists) {
    vscode.window.showErrorMessage(
      `Room ${roomCode} not found. Create or join a different room.`
    );
    outputChannel.appendLine(`[REZO] Room ${roomCode} not found.`);
    return;
  }

  // Check for expiry
  const expired = await checkAndCleanupRoom(roomCode, outputChannel);
  if (expired) {
    vscode.window.showWarningMessage(
      'Room expired. Create or join a new room.'
    );
    return;
  }

  await context.workspaceState.update(KEY_ACTIVE_ROOM, roomCode);
  statusBar.update(roomCode);
  outputChannel.appendLine(`[REZO] Joined room ${roomCode}`);
  vscode.window.showInformationMessage(`REZO: Joined room ${roomCode}`);
}

/**
 * Leave the current room — clears the stored room code and updates the status bar.
 */
export async function leaveRoom(
  context: vscode.ExtensionContext,
  statusBar: StatusBarManager,
  outputChannel: vscode.OutputChannel
): Promise<void> {
  const current = getActiveRoom(context);
  await context.workspaceState.update(KEY_ACTIVE_ROOM, undefined);
  statusBar.update(undefined);

  const msg = current
    ? `REZO: Left room ${current}`
    : 'REZO: No active room to leave.';
  vscode.window.showInformationMessage(msg);
  outputChannel.appendLine(`[REZO] Left room: ${current ?? '(none)'}`);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Check if a room has expired (lastActivity older than 35 minutes).
 * If expired, delete it from Firebase and return true.
 * Returns false if the room is still valid.
 */
export async function checkAndCleanupRoom(
  roomCode: string,
  outputChannel: vscode.OutputChannel
): Promise<boolean> {
  let lastActivity: number | null;
  try {
    lastActivity = await getRoomLastActivity(roomCode);
  } catch (err) {
    // Network error — can't determine expiry; assume still valid
    outputChannel.appendLine(
      `[REZO] checkAndCleanupRoom: could not read lastActivity for ${roomCode}`
    );
    return false;
  }

  if (lastActivity === null) {
    // Room doesn't exist
    return true;
  }

  const age = Date.now() - lastActivity;
  if (age > ROOM_EXPIRY_MS) {
    outputChannel.appendLine(
      `[REZO] Room ${roomCode} expired (age ${Math.round(age / 60000)}m). Deleting…`
    );
    try {
      await deleteRoom(roomCode);
    } catch (err) {
      outputChannel.appendLine(
        `[REZO] Failed to delete expired room ${roomCode}: ${err}`
      );
    }
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Active room accessor
// ---------------------------------------------------------------------------

/**
 * Return the currently active room code from workspaceState, or undefined.
 */
export function getActiveRoom(
  context: vscode.ExtensionContext
): string | undefined {
  return context.workspaceState.get<string>(KEY_ACTIVE_ROOM);
}
