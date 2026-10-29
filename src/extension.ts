import * as vscode from 'vscode';
import * as path from 'path';

import { StatusBarManager } from './statusBar';
import {
  createRoom,
  joinRoom,
  leaveRoom,
  getActiveRoom,
  getRoomKey,
  migrateWorkspaceState,
} from './roomManager';
import { firebasePut } from './firebase';
import {
  GhostMessage,
  MessageEnvelope,
  getSenderName,
  setDisplayName,
  cacheMessages,
  getCachedMessages,
  sendRoomMessage,
  fetchRoomMessages,
  unpackMessage,
  buildCommentBlock,
} from './messageStore';
import {
  askAIWithFallback,
  storeApiKey,
  parseSlashCommand,
  getSlashCommands,
} from './ai';
import { SSESubscription } from './sse';
import {
  getVaultCredentials,
  saveToVault,
  listVault,
  deleteVaultItem,
  generateTitle,
  VaultItem,
} from './vault';
import { getGitContext } from './git';
import { PresenceManager } from './presence';
import { RezoCommentController } from './commentController';
import { ChatTerminal, ChatLine } from './chatTerminal';
import { displayCode, makeInvite } from './crypto';

// ---------------------------------------------------------------------------
// Extension activation
// ---------------------------------------------------------------------------

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel('REZO');
  outputChannel.appendLine('[REZO] Extension activating…');
  await migrateWorkspaceState(context);

  const statusBar = new StatusBarManager();
  context.subscriptions.push({ dispose: () => statusBar.dispose() });

  // The room key for the currently active room. Held in memory only while a
  // room is open; everything written to Firebase is encrypted with it.
  let activeKey: Buffer | undefined;
  let panicked = false;

  // IDs of messages this instance sent. Used to suppress our own SSE echo
  // WITHOUT relying on the display name — two windows on one machine (or two
  // people with the same name) share a name but never share message ids, so
  // id-based dedup lets them actually see each other.
  const sentIds = new Set<string>();
  function markSent(id: string): void {
    sentIds.add(id);
    if (sentIds.size > 300) {
      // Trim oldest-ish to keep the set bounded.
      const first = sentIds.values().next().value;
      if (first !== undefined) sentIds.delete(first);
    }
  }

  const presence = new PresenceManager(
    context,
    () => getSenderName(context),
    outputChannel
  );
  context.subscriptions.push({ dispose: () => presence.dispose() });
  presence.onChange((count, names) => {
    statusBar.setPresence(count, names);
    if (chat?.isOpen && count > 0) {
      chat.writeNote(`// ${count} online: ${names.join(', ')}`);
    }
  });

  // Comment controller — messages pinned to a (file, line) render as native
  // review threads. Replies go back through the encrypted send path.
  const commentCtrl = new RezoCommentController(
    () => getSenderName(context),
    async (parent, content) => {
      const roomCode = getActiveRoom(context);
      if (!roomCode || !activeKey) return undefined;
      const git = getGitContext(parent.file);
      const reply: GhostMessage = {
        id: newId(),
        roomCode,
        sender: getSenderName(context),
        content,
        file: parent.file,
        line: parent.line,
        timestamp: Date.now(),
        replyTo: parent.id,
        ...gitFields(git),
      };
      markSent(reply.id);
      await sendRoomMessage(reply, activeKey);
      return reply;
    },
    outputChannel
  );
  context.subscriptions.push({ dispose: () => commentCtrl.dispose() });

  // Terminal chat — the primary, "looks like a shell" chat surface.
  let chat: ChatTerminal | undefined;

  function ensureChat(): ChatTerminal {
    if (chat) return chat;
    const disguise = vscode.workspace
      .getConfiguration('rezo')
      .get<string>('chatDisguise', 'node');
    chat = new ChatTerminal(
      disguise,
      (text) => void handleChatSend(text),
      () => {
        const room = getActiveRoom(context);
        return room ? displayCode(room) : 'no room';
      },
      () => {
        /* user closed terminal — keep realtime running silently */
      },
      () => recentChatLines()
    );
    context.subscriptions.push({ dispose: () => chat?.dispose() });
    return chat;
  }

  function recentChatLines(): ChatLine[] {
    const room = getActiveRoom(context);
    if (!room) return [];
    const myName = getSenderName(context);
    return getCachedMessages(context, room)
      .slice(-15)
      .map((m) => ({
        sender: m.sender,
        content: m.content,
        self: m.sender === myName,
        ts: m.timestamp,
      }));
  }

  async function handleChatSend(text: string): Promise<void> {
    const roomCode = getActiveRoom(context);
    if (!roomCode || !activeKey) {
      chat?.writeNote('// no active room — run "REZO: Create/Join Room"');
      return;
    }
    const sender = getSenderName(context);
    const msg: GhostMessage = {
      id: newId(),
      roomCode,
      sender,
      content: text,
      timestamp: Date.now(),
    };
    // Optimistic local echo before the network round-trip.
    chat?.writeIncoming({ sender, content: text, self: true, ts: msg.timestamp });
    markSent(msg.id);
    try {
      await sendRoomMessage(msg, activeKey);
    } catch (err) {
      chat?.writeNote(`// send failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Restore active room on startup.
  const storedRoom = getActiveRoom(context);
  if (storedRoom) {
    statusBar.update(storedRoom);
    outputChannel.appendLine(`[REZO] Restored active room: ${displayCode(storedRoom)}`);
  }

  // ---------------------------------------------------------------------------
  // Real-time SSE subscription
  // ---------------------------------------------------------------------------
  let activeSSE: SSESubscription | undefined;

  async function startRealtime(roomCode: string, key: Buffer): Promise<void> {
    stopRealtime();
    activeKey = key;
    panicked = false;
    outputChannel.appendLine(`[REZO] Starting realtime for ${displayCode(roomCode)}`);

    try {
      const initial = await fetchRoomMessages(roomCode, key);
      commentCtrl.setMessages(initial);
      await cacheMessages(context, roomCode, initial);
      outputChannel.appendLine(`[REZO] Seeded ${initial.length} message(s)`);
    } catch (err) {
      const cached = getCachedMessages(context, roomCode);
      commentCtrl.setMessages(cached);
      outputChannel.appendLine(
        `[REZO] Seed failed, using ${cached.length} cached: ${errText(err)}`
      );
    }

    presence.start(roomCode, key);

    activeSSE = new SSESubscription(
      `rooms/${roomCode}/messages`,
      (msg) => {
        if (msg.eventName !== 'put' || !activeKey) return;
        if (msg.path === '/') {
          const data = msg.data as Record<string, MessageEnvelope> | null;
          const list: GhostMessage[] = [];
          if (data && typeof data === 'object') {
            for (const env of Object.values(data)) {
              const m = unpackMessage(roomCode, env, activeKey);
              if (m) list.push(m);
            }
          }
          if (!panicked) commentCtrl.setMessages(list);
          void cacheMessages(context, roomCode, list);
        } else if (msg.data) {
          const incoming = unpackMessage(roomCode, msg.data as MessageEnvelope, activeKey);
          if (incoming) {
            if (!panicked && (incoming.file || typeof incoming.line === 'number')) {
              commentCtrl.addMessage(incoming);
            }
            handleNewMessage(incoming);
          }
        }
      },
      (err) => outputChannel.appendLine(`[REZO SSE] error: ${err.message}`)
    );
    activeSSE.start();
  }

  function stopRealtime(): void {
    if (activeSSE) {
      activeSSE.stop();
      activeSSE = undefined;
    }
    presence.stop();
    commentCtrl.clear();
    activeKey = undefined;
  }

  function handleNewMessage(msg: GhostMessage): void {
    // Our own message echoed back by Firebase — we already showed it locally.
    if (sentIds.has(msg.id)) {
      sentIds.delete(msg.id);
      return;
    }

    const room = getActiveRoom(context);
    if (room) {
      const prior = getCachedMessages(context, room);
      void cacheMessages(context, room, [...prior, msg]);
    }

    if (panicked) return;

    if (chat?.isOpen) {
      chat.writeIncoming({
        sender: msg.sender,
        content: msg.content,
        self: false,
        ts: msg.timestamp,
      });
    }

    statusBar.setUnreadCount(statusBar.getUnreadCount() + 1);

    const notify = vscode.workspace
      .getConfiguration('rezo')
      .get<string>('notify', 'toast');
    if (notify === 'toast') {
      const preview = msg.content.length > 60 ? msg.content.slice(0, 60) + '…' : msg.content;
      void vscode.window.showInformationMessage(`REZO · ${msg.sender}: ${preview}`);
    }
  }

  if (storedRoom) {
    const key = await getRoomKey(context, storedRoom);
    if (key) {
      void startRealtime(storedRoom, key);
    } else {
      outputChannel.appendLine('[REZO] No key for stored room — re-join to decrypt.');
      vscode.window.showWarningMessage(
        'REZO: This room needs its invite to decrypt on this machine. Join again to reconnect.'
      );
    }
  }

  context.subscriptions.push({ dispose: stopRealtime });

  const walkthroughId = `${context.extension.id}#rezo.getStarted`;
  const openWelcome = () =>
    vscode.commands.executeCommand('workbench.action.openWalkthrough', walkthroughId, false);

  // First run: open the Getting Started walkthrough. Later runs without a
  // room get the lighter nudge.
  if (!context.globalState.get<boolean>('rezo.welcomeShown')) {
    await context.globalState.update('rezo.welcomeShown', true);
    void openWelcome();
  } else if (!storedRoom) {
    void vscode.window
      .showInformationMessage(
        'REZO: No active room. Create one or join with an invite.',
        'Create Room',
        'Join Room'
      )
      .then((choice) => {
        if (choice === 'Create Room') vscode.commands.executeCommand('rezo.createRoom');
        else if (choice === 'Join Room') vscode.commands.executeCommand('rezo.joinRoom');
      });
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  const register = (id: string, fn: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  register('rezo.showWelcome', openWelcome);

  register('rezo.createRoom', async () => {
    const result = await createRoom(context, statusBar, outputChannel);
    if (result) {
      await startRealtime(result.roomId, result.key);
      ensureChat().open();
    }
  });

  register('rezo.joinRoom', async () => {
    const result = await joinRoom(context, statusBar, outputChannel);
    if (result) {
      await startRealtime(result.roomId, result.key);
      ensureChat().open();
    }
  });

  register('rezo.leaveRoom', async () => {
    stopRealtime();
    chat?.dispose();
    chat = undefined;
    statusBar.clearUnread();
    await leaveRoom(context, statusBar, outputChannel);
  });

  // Toggle / open the terminal chat.
  register('rezo.openChat', async () => {
    const room = getActiveRoom(context);
    if (!room) {
      const choice = await vscode.window.showInformationMessage(
        'REZO: No active room. Create or join one first.',
        'Create Room',
        'Join Room'
      );
      if (choice === 'Create Room') vscode.commands.executeCommand('rezo.createRoom');
      else if (choice === 'Join Room') vscode.commands.executeCommand('rezo.joinRoom');
      return;
    }
    if (!activeKey) {
      const key = await getRoomKey(context, room);
      if (!key) {
        vscode.window.showWarningMessage('REZO: Missing room key — re-join with the invite.');
        return;
      }
      await startRealtime(room, key);
    }
    panicked = false;
    statusBar.clearUnread();
    ensureChat().open();
  });

  // Panic — instantly hide every REZO surface.
  register('rezo.panic', () => {
    panicked = true;
    commentCtrl.clear();
    chat?.dispose();
    chat = undefined;
    statusBar.clearUnread();
    outputChannel.appendLine('[REZO] Panic — surfaces hidden.');
  });

  register('rezo.copyInvite', async () => {
    const room = getActiveRoom(context);
    if (!room) {
      vscode.window.showWarningMessage('REZO: No active room.');
      return;
    }
    const key = await getRoomKey(context, room);
    if (!key) {
      vscode.window.showWarningMessage('REZO: No key for this room.');
      return;
    }
    await vscode.env.clipboard.writeText(makeInvite(room, key));
    vscode.window.showInformationMessage(
      'REZO: Invite copied. It contains the decryption key — share it privately.'
    );
  });

  // Pin the current selection to a review thread on its line.
  register('rezo.pinSelection', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('REZO: No active editor.');
      return;
    }
    const selectedText = editor.document.getText(editor.selection).trim();
    if (!selectedText) {
      vscode.window.showWarningMessage('REZO: Select some text to pin.');
      return;
    }
    const roomCode = getActiveRoom(context);
    if (!roomCode || !activeKey) {
      vscode.window.showWarningMessage('REZO: No active room.');
      return;
    }
    const note = await vscode.window.showInputBox({
      prompt: 'Add a note for this pin (optional)',
      placeHolder: 'e.g. is this a race condition?',
    });
    if (note === undefined) return;

    const fileName = path.basename(editor.document.fileName);
    const line = editor.selection.start.line + 1;
    const git = getGitContext(editor.document.fileName);
    const content = note.trim()
      ? `${note.trim()}\n\n> ${selectedText.split('\n')[0].slice(0, 120)}`
      : selectedText;

    const msg: GhostMessage = {
      id: newId(),
      roomCode,
      sender: getSenderName(context),
      content,
      file: fileName,
      line,
      timestamp: Date.now(),
      ...gitFields(git),
    };
    markSent(msg.id);
    try {
      await sendRoomMessage(msg, activeKey);
      vscode.window.showInformationMessage(`REZO: Pinned to ${fileName}:${line}.`);
    } catch (err) {
      vscode.window.showErrorMessage(`REZO: Failed to pin — ${errText(err)}`);
    }
  });

  register('rezo.replyThread', async (reply: vscode.CommentReply) => {
    try {
      await commentCtrl.reply(reply.thread, reply.text);
    } catch (err) {
      vscode.window.showErrorMessage(`REZO: Reply failed — ${errText(err)}`);
    }
  });

  register('rezo.refreshThreads', async () => {
    const roomCode = getActiveRoom(context);
    if (!roomCode || !activeKey) {
      vscode.window.showWarningMessage('REZO: No active room.');
      return;
    }
    try {
      const messages = await fetchRoomMessages(roomCode, activeKey);
      await cacheMessages(context, roomCode, messages);
      commentCtrl.setMessages(messages);
      statusBar.clearUnread();
      vscode.window.showInformationMessage(`REZO: ${messages.length} thread(s) refreshed.`);
    } catch (err) {
      const cached = getCachedMessages(context, roomCode);
      commentCtrl.setMessages(cached);
      vscode.window.showWarningMessage(`REZO: Offline — showing ${cached.length} cached.`);
    }
  });

  register('rezo.showChatHistory', async () => {
    const roomCode = getActiveRoom(context);
    if (!roomCode || !activeKey) {
      vscode.window.showWarningMessage('REZO: No active room.');
      return;
    }
    let messages: GhostMessage[];
    try {
      messages = await fetchRoomMessages(roomCode, activeKey);
      await cacheMessages(context, roomCode, messages);
    } catch (err) {
      messages = getCachedMessages(context, roomCode);
      vscode.window.showWarningMessage(`REZO: Offline — showing cached.`);
    }

    const header = `# REZO chat — ${displayCode(roomCode)}\n\n${messages.length} message(s)\n\n---\n\n`;
    const body =
      messages.length === 0
        ? '_No messages yet._'
        : messages
            .map((m) => {
              const when = new Date(m.timestamp).toLocaleString();
              const where = m.file ? ` · \`${m.file}:${m.line}\`` : '';
              return `**${m.sender}** · *${when}*${where}\n\n${m.content}\n`;
            })
            .join('\n---\n\n');

    const doc = await vscode.workspace.openTextDocument({
      content: header + body,
      language: 'markdown',
    });
    await vscode.window.showTextDocument(doc, { preview: false });
    statusBar.clearUnread();
  });

  register('rezo.setDisplayName', async () => {
    const current = getSenderName(context);
    const input = await vscode.window.showInputBox({
      prompt: 'Enter your display name for REZO messages',
      placeHolder: 'e.g. alice',
      value: current,
      validateInput: (value) => {
        if (!value || value.trim().length === 0) return 'Display name cannot be empty';
        if (value.trim().length > 30) return 'Display name must be 30 characters or fewer';
        return null;
      },
    });
    if (!input) return;
    await setDisplayName(context, input);
    vscode.window.showInformationMessage(`REZO: Display name set to "${input.trim()}"`);
  });

  // Ask AI — answer inserted privately at cursor, never sent to the room.
  // Comment terminators in the answer are neutralized so it can't break out
  // of its comment block.
  register('rezo.askAI', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('REZO: No active editor.');
      return;
    }
    const selectedText = editor.document.getText(editor.selection).trim();
    if (!selectedText) {
      vscode.window.showWarningMessage('REZO: Select code or a question first.');
      return;
    }
    const { command, prompt } = parseSlashCommand(selectedText);
    const langHint = `Language: ${editor.document.languageId}\n\n`;
    const finalPrompt = command ? `${langHint}${prompt}` : selectedText;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: command ? `REZO: ${command.trigger}…` : 'REZO: Asking AI…',
        cancellable: false,
      },
      async () => {
        try {
          const { answer, provider } = await askAIWithFallback(
            finalPrompt,
            context,
            outputChannel,
            command?.systemPrompt
          );
          const block = buildCommentBlock(answer, editor.document.languageId);
          await editor.edit((eb) => eb.insert(editor.selection.end, '\n' + block));
          vscode.window.showInformationMessage(`REZO: ${provider} answered.`);
        } catch (err) {
          vscode.window.showErrorMessage(`REZO AI: ${errText(err)}`);
        }
      }
    );
  });

  register('rezo.setAIKeys', async () => {
    const provider = await vscode.window.showQuickPick(
      [
        { label: '$(key) Gemini', description: 'Free at aistudio.google.com/apikey', provider: 'gemini' as const },
        { label: '$(key) DeepSeek', description: 'Free tier at platform.deepseek.com', provider: 'deepseek' as const },
        { label: '$(key) Groq', description: 'Free tier at console.groq.com/keys', provider: 'groq' as const },
      ],
      { title: 'REZO: Set AI Keys', placeHolder: 'Choose which provider key to set' }
    );
    if (!provider) return;
    const input = await vscode.window.showInputBox({
      prompt: `Enter your ${provider.provider} API key`,
      placeHolder: 'API key…',
      ignoreFocusOut: true,
      password: true,
      validateInput: (v) => (!v || v.trim().length < 10 ? 'Please enter a valid API key' : null),
    });
    if (!input) return;
    await storeApiKey(context, provider.provider, input);
    vscode.window.showInformationMessage(`REZO: ${provider.provider} key saved securely.`);
  });

  register('rezo.showSlashCommands', async () => {
    const cmds = getSlashCommands();
    const picked = await vscode.window.showQuickPick(
      cmds.map((c) => ({ label: c.trigger, description: c.description })),
      { title: 'REZO Slash Commands', placeHolder: 'Prefix your selection before "REZO: Ask AI"' }
    );
    if (picked) {
      await vscode.env.clipboard.writeText(picked.label + ' ');
      vscode.window.showInformationMessage(`REZO: "${picked.label} " copied.`);
    }
  });

  register('rezo.saveToVault', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('REZO: No active editor.');
      return;
    }
    const selectedText = editor.document.getText(editor.selection);
    if (!selectedText.trim()) {
      vscode.window.showWarningMessage('REZO: Select text before saving to vault.');
      return;
    }
    const autoTitle = generateTitle(selectedText);
    const title = await vscode.window.showInputBox({
      prompt: 'Vault item title (or Enter for auto)',
      placeHolder: autoTitle,
      value: autoTitle,
    });
    if (title === undefined) return;
    try {
      const creds = await getVaultCredentials(context);
      const id = await saveToVault(creds, {
        content: selectedText,
        language: editor.document.languageId,
        file: path.basename(editor.document.fileName || 'untitled'),
        line: editor.selection.start.line + 1,
        title: title.trim() || autoTitle,
      });
      if (!id) throw new Error('vault save returned no id');
      vscode.window.showInformationMessage('REZO: Saved to vault.');
    } catch (err) {
      vscode.window.showErrorMessage(`REZO Vault: ${errText(err)}`);
    }
  });

  register('rezo.openVault', async () => {
    let items: VaultItem[];
    let creds;
    try {
      creds = await getVaultCredentials(context);
      items = await listVault(creds);
    } catch (err) {
      vscode.window.showErrorMessage(`REZO Vault: ${errText(err)}`);
      return;
    }
    if (items.length === 0) {
      vscode.window.showInformationMessage('REZO: Your vault is empty.');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      items.map((item) => ({
        label: `$(archive) ${item.title}`,
        description: `[${item.language}] ${item.file}:${item.line}`,
        detail: `${new Date(item.timestamp).toLocaleString()} — ${item.content.split('\n')[0].slice(0, 60)}`,
        item,
      })),
      { title: `REZO Vault — ${items.length} item(s)`, placeHolder: 'Pick an item' }
    );
    if (!picked) return;
    const action = await vscode.window.showQuickPick(
      [
        { label: '$(arrow-down) Insert at cursor', value: 'insert' as const },
        { label: '$(clippy) Copy to clipboard', value: 'copy' as const },
        { label: '$(trash) Delete from vault', value: 'delete' as const },
      ],
      { title: picked.item.title, placeHolder: 'What do you want to do?' }
    );
    if (!action) return;
    if (action.value === 'insert') {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('REZO: Open a file first.');
        return;
      }
      await editor.edit((eb) => eb.insert(editor.selection.active, picked.item.content));
      vscode.window.showInformationMessage(`REZO Vault: Inserted "${picked.item.title}"`);
    } else if (action.value === 'copy') {
      await vscode.env.clipboard.writeText(picked.item.content);
      vscode.window.showInformationMessage(`REZO Vault: Copied "${picked.item.title}"`);
    } else if (action.value === 'delete') {
      const confirm = await vscode.window.showWarningMessage(
        `Delete vault item "${picked.item.title}"?`,
        { modal: true },
        'Delete'
      );
      if (confirm === 'Delete') {
        try {
          await deleteVaultItem(creds, picked.item.id);
          vscode.window.showInformationMessage(`REZO Vault: Deleted "${picked.item.title}"`);
        } catch (err) {
          vscode.window.showErrorMessage(`REZO Vault: ${errText(err)}`);
        }
      }
    }
  });

  outputChannel.appendLine('[REZO] Extension activated successfully.');
}

export function deactivate(): void {
  // Subscriptions handle cleanup.
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function gitFields(
  git: ReturnType<typeof getGitContext>
): Partial<GhostMessage> {
  if (!git) return {};
  return {
    commit: git.sha,
    commitShort: git.shortSha,
    branch: git.branch ?? undefined,
    dirty: git.dirty,
  };
}
