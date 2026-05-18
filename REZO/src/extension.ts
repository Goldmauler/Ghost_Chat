import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';

import { StatusBarManager } from './statusBar';
import {
  createRoom,
  joinRoom,
  leaveRoom,
  getActiveRoom,
  checkAndCleanupRoom,
} from './roomManager';
import {
  sendMessage as firebaseSendMessage,
  getMessages,
} from './firebase';
import {
  GhostMessage,
  getSenderName,
  setDisplayName,
  cacheMessages,
  getCachedMessages,
  formatHistoryBlock,
} from './messageStore';

// ---------------------------------------------------------------------------
// Extension activation
// ---------------------------------------------------------------------------

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  // 1. Output channel for debug logs
  const outputChannel = vscode.window.createOutputChannel('REZO');
  outputChannel.appendLine('[REZO] Extension activating…');

  // 2. Status bar
  const statusBar = new StatusBarManager();
  context.subscriptions.push({ dispose: () => statusBar.dispose() });

  // 3. Firebase is always available via built-in config — no setup needed
  const hasFirebaseConfig = true;

  // 4. Restore active room from workspaceState
  const storedRoom = getActiveRoom(context);
  if (storedRoom) {
    statusBar.update(storedRoom);
    outputChannel.appendLine(`[REZO] Restored active room: ${storedRoom}`);
  }

  // 5. First-run experience — just prompt for room, no Firebase setup needed
  if (!storedRoom) {
    vscode.window
      .showInformationMessage(
        "REZO: No active room. Create one or join an existing room.",
        'Create Room',
        'Join Room'
      )
      .then((choice) => {
        if (choice === 'Create Room') {
          vscode.commands.executeCommand('rezo.createRoom');
        } else if (choice === 'Join Room') {
          vscode.commands.executeCommand('rezo.joinRoom');
        }
      });
  }

  // ---------------------------------------------------------------------------
  // Command: rezo.createRoom
  // ---------------------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('rezo.createRoom', async () => {
      await createRoom(context, statusBar, outputChannel);
    })
  );

  // ---------------------------------------------------------------------------
  // Command: rezo.joinRoom
  // ---------------------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('rezo.joinRoom', async () => {
      await joinRoom(context, statusBar, outputChannel);
    })
  );

  // ---------------------------------------------------------------------------
  // Command: rezo.leaveRoom
  // ---------------------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('rezo.leaveRoom', async () => {
      await leaveRoom(context, statusBar, outputChannel);
    })
  );

  // ---------------------------------------------------------------------------
  // Command: rezo.sendMessage  (Ctrl+Shift+S)
  // ---------------------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('rezo.sendMessage', async () => {

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('REZO: No active editor.');
        return;
      }

      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);

      if (!selectedText || selectedText.trim().length === 0) {
        vscode.window.showWarningMessage('Select some text before sending.');
        return;
      }

      const roomCode = getActiveRoom(context);
      if (!roomCode) {
        vscode.window.showWarningMessage(
          "REZO: No active room. Run 'REZO: Create New Room' or 'REZO: Join Room by Code' first."
        );
        return;
      }

      const sender = getSenderName(context);
      const fileName = path.basename(editor.document.fileName);
      const line = selection.start.line + 1; // 1-based

      const msg: GhostMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        roomCode,
        sender,
        content: selectedText.trim(),
        file: fileName,
        line,
        timestamp: Date.now(),
      };

      outputChannel.appendLine(
        `[REZO] Sending message from ${sender} in room ${roomCode}: "${msg.content.slice(0, 60)}…"`
      );

      try {
        await firebaseSendMessage(msg);
        vscode.window.showInformationMessage(
          `REZO: Message sent to room ${roomCode}.`
        );
        outputChannel.appendLine('[REZO] Message sent successfully.');
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`REZO: Failed to send — ${errMsg}`);
        outputChannel.appendLine(`[REZO] sendMessage error: ${errMsg}`);
      }
    })
  );

  // ---------------------------------------------------------------------------
  // Command: rezo.receiveHistory  (Ctrl+Shift+V)
  // ---------------------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('rezo.receiveHistory', async () => {

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('REZO: No active editor.');
        return;
      }

      const roomCode = getActiveRoom(context);
      if (!roomCode) {
        vscode.window.showWarningMessage(
          "REZO: No active room. Run 'REZO: Create New Room' or 'REZO: Join Room by Code' first."
        );
        return;
      }

      // Check room expiry
      const expired = await checkAndCleanupRoom(roomCode, outputChannel);
      if (expired) {
        await context.workspaceState.update('rezo.activeRoomCode', undefined);
        statusBar.update(undefined);
        vscode.window.showWarningMessage(
          'Room expired. Create or join a new room.'
        );
        return;
      }

      let messages: GhostMessage[];
      let usingCache = false;

      try {
        outputChannel.appendLine(
          `[REZO] Fetching history for room ${roomCode}…`
        );
        messages = await getMessages(roomCode);
        await cacheMessages(context, roomCode, messages);
        outputChannel.appendLine(
          `[REZO] Fetched ${messages.length} messages from Firebase.`
        );
      } catch (err) {
        // Network error — fall back to cache
        outputChannel.appendLine(
          `[REZO] Network error fetching history, falling back to cache: ${err}`
        );
        messages = getCachedMessages(context, roomCode);
        usingCache = true;
      }

      if (messages.length === 0 && !usingCache) {
        vscode.window.showInformationMessage(
          `REZO: No messages in room ${roomCode} yet.`
        );
        return;
      }

      // Build the comment block
      const languageId = editor.document.languageId;
      const historyBlock = formatHistoryBlock(messages, roomCode, languageId);

      // Insert at current cursor position
      const insertPos = editor.selection.active;
      await editor.edit((editBuilder) => {
        editBuilder.insert(insertPos, historyBlock);
      });

      if (usingCache) {
        vscode.window.showWarningMessage(
          'REZO: Network error. Using cached history.'
        );
      } else {
        vscode.window.showInformationMessage(
          'History inserted at cursor. Delete this block when done.'
        );
      }

      outputChannel.appendLine(
        `[REZO] History block inserted at cursor (${messages.length} messages).`
      );
    })
  );

  // ---------------------------------------------------------------------------
  // Command: rezo.setDisplayName
  // ---------------------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('rezo.setDisplayName', async () => {
      const current = getSenderName(context);
      const input = await vscode.window.showInputBox({
        prompt: 'Enter your display name for REZO messages',
        placeHolder: 'e.g. alice',
        value: current,
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return 'Display name cannot be empty';
          }
          if (value.trim().length > 30) {
            return 'Display name must be 30 characters or fewer';
          }
          return null;
        },
      });

      if (!input) return;

      await setDisplayName(context, input);
      vscode.window.showInformationMessage(
        `REZO: Display name set to "${input.trim()}"`
      );
      outputChannel.appendLine(`[REZO] Display name set to "${input.trim()}"`);
    })
  );

  outputChannel.appendLine('[REZO] Extension activated successfully.');
}

export function deactivate(): void {
  // Nothing to clean up — statusBar is in subscriptions
}
