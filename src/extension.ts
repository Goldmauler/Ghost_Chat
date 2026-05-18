import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
/// <reference types="node" />
import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import * as dgram from 'dgram';
import { GhostChatGroupRecord, GhostChatMessage, SharedHistoryStore } from './sharedHistory';

const STORAGE_KEYS = {
  sharedFilePath: 'ghostchat.sharedFilePath',
  activeGroupId: 'ghostchat.activeGroupId',
  senderName: 'ghostchat.senderName',
  setupComplete: 'ghostchat.setupComplete'
} as const;

function formatTimestampForStorage(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

function formatTimestampForDisplay(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return timestamp;
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function resolveDefaultSenderName(): string {
  const username = os.userInfo().username.trim();
  return username || 'Unknown';
}

function formatSenderHeader(message: GhostChatMessage): string {
  const displayTime = formatTimestampForDisplay(message.timestamp);
  const location = message.file ? ` (${message.file}:${message.line})` : '';
  return `[${displayTime}] ${message.sender}${location}:`;
}

function formatMessageCommentLines(message: GhostChatMessage, prefix: string, suffix: string): string[] {
  const contentLines = message.content.split(/\r?\n/);
  const lines: string[] = [];

  lines.push(`${prefix}${formatSenderHeader(message)} ${contentLines[0] ?? ''}${suffix}`.trimEnd());

  for (const contentLine of contentLines.slice(1)) {
    lines.push(`${prefix}${contentLine}${suffix}`.trimEnd());
  }

  return lines;
}

function getCommentMarkup(languageId: string): { prefix: string; suffix: string } {
  const lineCommentLanguages = new Set([
    'javascript',
    'javascriptreact',
    'typescript',
    'typescriptreact',
    'java',
    'c',
    'cpp',
    'csharp',
    'go',
    'rust',
    'php',
    'swift',
    'kotlin',
    'dart',
    'jsonc',
    'shellscript',
    'powershell',
    'lua',
    'sql'
  ]);

  const hashCommentLanguages = new Set([
    'python',
    'r',
    'ruby',
    'perl',
    'yaml',
    'dockerfile',
    'makefile',
    'ini',
    'toml'
  ]);

  if (languageId === 'html' || languageId === 'xml' || languageId === 'markdown') {
    return { prefix: '<!-- ', suffix: ' -->' };
  }

  if (hashCommentLanguages.has(languageId)) {
    return { prefix: '# ', suffix: '' };
  }

  if (lineCommentLanguages.has(languageId)) {
    return { prefix: '// ', suffix: '' };
  }

  return { prefix: '// ', suffix: '' };
}

function buildHistoryBlock(messages: GhostChatMessage[], groupId: string, languageId: string): string {
  const { prefix, suffix } = getCommentMarkup(languageId);
  const lines: string[] = [];

  lines.push(`${prefix}===== GHOSTCHAT HISTORY [Group: ${groupId}] =====${suffix}`.trimEnd());

  for (const message of messages) {
    lines.push(...formatMessageCommentLines(message, prefix, suffix));
  }

  lines.push(`${prefix}===== END HISTORY =====${suffix}`.trimEnd());
  return `${lines.join('\n')}\n`;
}

function generateGroupId(): string {
  const shortId = randomBytes(2).toString('hex').toUpperCase();
  return `TEAM-${shortId}`;
}

function generateMessageId(): string {
  const timePart = Date.now().toString(36);
  const randomPart = randomBytes(8).toString('hex');
  return `${timePart}-${randomPart}`;
}

function isLikelyFilePath(value: string): boolean {
  const normalized = value.trim();
  return normalized.includes('/')
    || normalized.includes('\\')
    || /^[a-zA-Z]:/.test(normalized)
    || normalized.toLowerCase().endsWith('.json');
}

function validateGroupId(input: string): string | undefined {
  const normalized = input.trim();

  if (!normalized) {
    return 'A Group ID is required.';
  }

  if (isLikelyFilePath(normalized)) {
    return 'That looks like a file path. Use the shared file path prompt for the JSON file, and enter a simple group name such as TEAM-Alpha.';
  }

  return undefined;
}

function friendlyFsMessage(error: unknown): string {
  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (lower.includes('enoent')) {
      return 'GhostChat could not find the shared file. Check the network path and folder name.';
    }

    if (lower.includes('eacces') || lower.includes('eperm') || lower.includes('permission')) {
      return 'GhostChat does not have permission to read or write the shared file.';
    }

    if (lower.includes('network') || lower.includes('offline') || lower.includes('timed out') || lower.includes('etimedout')) {
      return 'GhostChat cannot reach the shared file right now. Check the LAN connection and share path.';
    }

    return error.message;
  }

  return 'GhostChat encountered a file system error.';
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const controller = new GhostChatController(context);
  context.subscriptions.push(controller);
  await controller.initialize();
}

export function deactivate(): void {
  // VS Code disposes the controller through the subscription list.
}

class GhostChatController implements vscode.Disposable {
  private store: SharedHistoryStore | undefined;
  private watcher: vscode.Disposable | undefined;
  private watchRefreshTimer: any;
  private statusBar: vscode.StatusBarItem;
  private hostServer: http.Server | undefined;
  private hostPort: number | undefined;
  private remoteHostUrl: string | undefined;
  private discoverySocket: dgram.Socket | undefined;
  private discoveredHosts: Map<string, { url: string; lastSeen: number; label?: string }> = new Map();
  private broadcasterInterval: any;
  private readonly broadcastPort = 42818;
  private sharedFilePath: string | undefined;
  private activeGroupId: string | undefined;
  private senderName: string;
  private lastKnownLatestMessageId: string | undefined;
  private lastKnownMessageCount = 0;
  private disposed = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.senderName = this.getStoredSenderName();
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBar.command = 'ghostchat.showCurrentGroup';
    this.statusBar.show();

    this.registerCommands();
  }

  public async initialize(): Promise<void> {
    this.sharedFilePath = this.context.workspaceState.get<string>(STORAGE_KEYS.sharedFilePath);
    this.activeGroupId = this.context.workspaceState.get<string>(STORAGE_KEYS.activeGroupId);
    this.remoteHostUrl = this.context.workspaceState.get<string>('ghostchat.remoteHostUrl');

    // start background discovery listener so clients can find hosts automatically
    this.startDiscoveryListener();

    const setupComplete = this.context.workspaceState.get<boolean>(STORAGE_KEYS.setupComplete) === true;
    if (!setupComplete && !this.sharedFilePath && !this.remoteHostUrl) {
      await this.quickSetup();
    }

    if (!this.sharedFilePath && !this.remoteHostUrl) {
      await this.setSharedFilePath(true);
    }

    if (this.sharedFilePath) {
      await this.attachStore();
    }

    if (!this.activeGroupId) {
      await this.promptForInitialGroup();
    } else {
      await this.registerActiveGroup(this.activeGroupId);
    }

    await this.refreshStateFromDisk(true);
    this.updateStatusBar();
  }

  private buildStatusExtras(): string {
    const parts: string[] = [];
    if (this.hostPort) parts.push(`Host:${this.hostPort}`);
    if (this.remoteHostUrl) parts.push(`Conn:${this.remoteHostUrl}`);
    return parts.length ? ` (${parts.join(' | ')})` : '';
  }

  private async markSetupComplete(): Promise<void> {
    await this.context.workspaceState.update(STORAGE_KEYS.setupComplete, true);
  }

  public dispose(): void {
    this.disposed = true;

    if (this.watchRefreshTimer) {
      clearTimeout(this.watchRefreshTimer);
      this.watchRefreshTimer = undefined;
    }

    this.watcher?.dispose();
    this.statusBar.dispose();
    if (this.discoverySocket) {
      try { this.discoverySocket.close(); } catch { }
      this.discoverySocket = undefined;
    }
    if (this.broadcasterInterval) {
      clearInterval(this.broadcasterInterval);
      this.broadcasterInterval = undefined;
    }
  }

  private startDiscoveryListener(): void {
    try {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('error', (err) => { /* ignore */ });
      sock.on('message', (msg, rinfo) => {
        try {
          const parsed = JSON.parse(msg.toString());
          if (parsed && parsed.type === 'ghostchat' && parsed.url) {
            const key = `${rinfo.address}:${parsed.port}`;
            this.discoveredHosts.set(key, { url: parsed.url, lastSeen: Date.now(), label: parsed.label || rinfo.address });
          }
        } catch {
          // ignore non-json
        }
      });

      sock.bind(this.broadcastPort, '0.0.0.0', () => {
        try { sock.setBroadcast(true); } catch { }
      });

      this.discoverySocket = sock;

      // prune stale entries periodically
      setInterval(() => {
        const now = Date.now();
        for (const [k, v] of this.discoveredHosts) {
          if (now - v.lastSeen > 15000) this.discoveredHosts.delete(k);
        }
      }, 5000);
    } catch {
      // ignore discovery if system doesn't allow UDP sockets
    }
  }

  private registerCommands(): void {
    const subscriptions = [
      vscode.commands.registerCommand('ghostchat.setSharedFilePath', async () => {
        await this.setSharedFilePath(false);
      }),
      vscode.commands.registerCommand('ghostchat.quickSetup', async () => {
        await this.quickSetup();
      }),
      vscode.commands.registerCommand('ghostchat.createGroup', async () => {
        await this.createNewGroup();
      }),
      vscode.commands.registerCommand('ghostchat.joinGroup', async () => {
        await this.showGroupsInLan();
      }),
      vscode.commands.registerCommand('ghostchat.listGroups', async () => {
        await this.showGroupsInLan();
      }),
      vscode.commands.registerCommand('ghostchat.showGroupsInLan', async () => {
        await this.showGroupsInLan();
      }),
      vscode.commands.registerCommand('ghostchat.showSharedFilePath', async () => {
        if (!this.sharedFilePath) {
          vscode.window.showInformationMessage('GhostChat shared file path is not set.');
          return;
        }

        vscode.window.showInformationMessage(`GhostChat shared file path: ${this.sharedFilePath}`);
      }),
      vscode.commands.registerCommand('ghostchat.startHostShare', async () => {
        await this.startHostShare();
      }),
      vscode.commands.registerCommand('ghostchat.stopHostShare', async () => {
        await this.stopHostShare();
      }),
      vscode.commands.registerCommand('ghostchat.connectToHost', async () => {
        await this.connectToHost();
      }),
      vscode.commands.registerCommand('ghostchat.disconnectFromHost', async () => {
        this.remoteHostUrl = undefined;
        await this.context.workspaceState.update('ghostchat.remoteHostUrl', undefined);
        vscode.window.showInformationMessage('GhostChat: disconnected from host');
        this.updateStatusBar();
      }),
      vscode.commands.registerCommand('ghostchat.debugSharedGroups', async () => {
        await this.showSharedGroupsDiagnostics();
      }),
      vscode.commands.registerCommand('ghostchat.refreshGroups', async () => {
        await this.refreshStateFromDisk(false);
        vscode.window.showInformationMessage('GhostChat: groups refreshed.');
      }),
      vscode.commands.registerCommand('ghostchat.dumpSharedFile', async () => {
        await this.dumpSharedFileContents();
      }),
      vscode.commands.registerCommand('ghostchat.deleteGroup', async () => {
        await this.deleteGroupInteractive();
      }),
      vscode.commands.registerCommand('ghostchat.setActiveGroup', async () => {
        await this.setActiveGroupViaPicker();
      }),
      vscode.commands.registerCommand('ghostchat.showCurrentGroup', async () => {
        if (!this.activeGroupId) {
          vscode.window.showInformationMessage('GhostChat has no active group yet.');
          return;
        }

        vscode.window.showInformationMessage(`GhostChat current group: ${this.activeGroupId}`);
      }),
      vscode.commands.registerCommand('ghostchat.sendMessage', async () => {
        await this.sendSelectedText();
      }),
      vscode.commands.registerCommand('ghostchat.insertHistory', async () => {
        await this.insertHistoryAtCursor();
      }),
      vscode.commands.registerCommand('ghostchat.setSenderName', async () => {
        await this.setSenderName();
      })
    ];

    for (const subscription of subscriptions) {
      this.context.subscriptions.push(subscription);
    }
  }

  private getStoredSenderName(): string {
    const stored = this.context.workspaceState.get<string>(STORAGE_KEYS.senderName);
    if (stored && stored.trim()) {
      return stored.trim();
    }

    return resolveDefaultSenderName();
  }

  private async setSharedFilePath(initialPrompt: boolean): Promise<void> {
    const prompt = initialPrompt
      ? 'Enter the shared JSON file path'
      : 'Update the shared JSON file path';

    const value = await vscode.window.showInputBox({
      prompt,
      placeHolder: '\\\\192.168.1.105\\SharedFolder\\ghostchat_history.json',
      value: this.sharedFilePath,
      ignoreFocusOut: true,
      validateInput: (input: string) => input.trim() ? undefined : 'A full shared file path is required.'
    });

    if (!value) {
      if (initialPrompt) {
        vscode.window.showWarningMessage('GhostChat needs a shared file path before it can send or receive messages.');
      }

      return;
    }

    this.sharedFilePath = value.trim();
    await this.context.workspaceState.update(STORAGE_KEYS.sharedFilePath, this.sharedFilePath);
    await this.markSetupComplete();
    await this.attachStore();

    if (this.activeGroupId) {
      await this.registerActiveGroup(this.activeGroupId);
    }

    this.updateStatusBar();
  }

  private async quickSetup(): Promise<void> {
    const choice = await vscode.window.showQuickPick([
      { label: 'Host on this computer', description: 'Recommended. Starts sharing immediately.' },
      { label: 'Connect to another computer', description: 'Join an existing host by URL.' },
      { label: 'Use shared file path', description: 'Advanced mode for SMB/shared path.' },
      { label: 'Skip for now', description: 'Finish setup later' }
    ], {
      title: 'GhostChat Quick Setup',
      placeHolder: 'Choose the simplest way to start'
    });

    if (!choice || choice.label === 'Skip for now') {
      return;
    }

    if (choice.label === 'Host on this computer') {
      await this.startHostShare();
      return;
    }

    if (choice.label === 'Connect to another computer') {
      await this.connectToHost();
      return;
    }

    if (choice.label === 'Use shared file path') {
      await this.setSharedFilePath(true);
    }
  }

  private async promptForInitialGroup(): Promise<void> {
    const value = await vscode.window.showInputBox({
      prompt: 'Enter a Group ID to create or join',
      placeHolder: 'TEAM-Alpha',
      ignoreFocusOut: true,
      validateInput: validateGroupId
    });

    if (!value) {
      return;
    }

    await this.setActiveGroup(value.trim());
  }

  private async attachStore(): Promise<void> {
    if (!this.sharedFilePath) {
      return;
    }

    this.store = new SharedHistoryStore(this.sharedFilePath);

    try {
      await this.store.ensureReady();
    } catch (error) {
      vscode.window.showErrorMessage(friendlyFsMessage(error));
      return;
    }

    await this.refreshStateFromDisk(true);
    this.restartWatcher();
    // re-register active group remotely if needed
    if (this.activeGroupId && this.hostPort) {
      await this.registerActiveGroup(this.activeGroupId);
    }
  }

  private restartWatcher(): void {
    this.watcher?.dispose();
    this.watcher = undefined;

    if (!this.store) {
      return;
    }

    const watcher = this.store.watch(() => {
      if (this.disposed) {
        return;
      }

      if (this.watchRefreshTimer) {
        clearTimeout(this.watchRefreshTimer);
      }

      this.watchRefreshTimer = setTimeout(async () => {
        this.watchRefreshTimer = undefined;
        await this.refreshStateFromDisk(false);
      }, 250);
    });

    this.watcher = {
      dispose: () => watcher.close()
    };
  }

  private async refreshStateFromDisk(suppressNotifications: boolean): Promise<void> {
    if (!this.store && !this.remoteHostUrl) {
      return;
    }

    try {
      const messages = this.remoteHostUrl ? (await this.fetchRemoteEntries()).filter((entry) => !entry.kind) : await this.store!.readMessages();
      const latest = messages[messages.length - 1];
      const latestId = latest?.id;

      if (!suppressNotifications
        && latest
        && latestId !== this.lastKnownLatestMessageId
        && this.activeGroupId
        && latest.groupId === this.activeGroupId
        && latest.sender !== this.senderName) {
        vscode.window.showInformationMessage(`New message in Group ${latest.groupId}`);
      }

      this.lastKnownLatestMessageId = latestId;
      this.lastKnownMessageCount = messages.length;
      this.updateStatusBar();
    } catch (error) {
      if (!suppressNotifications) {
        vscode.window.showErrorMessage(friendlyFsMessage(error));
      }
    }
  }

  private updateStatusBar(): void {
    if (this.activeGroupId) {
      this.statusBar.text = `GhostChat • Group: ${this.activeGroupId}${this.buildStatusExtras()}`;
      this.statusBar.tooltip = `Sender: ${this.senderName}\nMessages tracked: ${this.lastKnownMessageCount}`;
      return;
    }

    const extras = this.buildStatusExtras();
    this.statusBar.text = `GhostChat • No Group${extras}`;
    this.statusBar.tooltip = 'GhostChat is waiting for a Group ID.';
  }

  private async createNewGroup(): Promise<void> {
    const suggested = generateGroupId();
    const groupId = await vscode.window.showInputBox({
      prompt: 'Create a new Group ID',
      placeHolder: suggested,
      value: suggested,
      ignoreFocusOut: true,
      validateInput: validateGroupId
    });

    if (!groupId) {
      return;
    }

    await this.setActiveGroup(groupId.trim());
  }

  private async joinExistingGroup(): Promise<void> {
    await this.showGroupsInLan();
  }

  private async showGroupsInLan(): Promise<void> {
    const existingGroups = await this.getKnownGroups();

    if (existingGroups.length === 0) {
      vscode.window.showInformationMessage('No groups found in the shared GhostChat file yet. Ask a teammate to send a message, or create a new group first.');
      return;
    }

    const selection = await vscode.window.showQuickPick(
      existingGroups.map((groupId) => ({ label: groupId })),
      {
        placeHolder: 'Click a group to join it'
      }
    );

    if (!selection) {
      return;
    }

    await this.setActiveGroup(selection.label);
  }

  private async setActiveGroupViaPicker(): Promise<void> {
    const existingGroups = await this.getKnownGroups();

    if (existingGroups.length === 0) {
      await this.promptForInitialGroup();
      return;
    }

    const selection = await vscode.window.showQuickPick(
      [
        ...existingGroups.map((groupId) => ({ label: groupId })),
        { label: 'Enter a different Group ID...', description: 'Type a new group manually' }
      ],
      {
        placeHolder: 'Choose the active Group ID'
      }
    );

    if (!selection) {
      return;
    }

    if (selection.label === 'Enter a different Group ID...') {
      await this.promptForInitialGroup();
      return;
    }

    await this.setActiveGroup(selection.label);
  }

  private async setActiveGroup(groupId: string): Promise<void> {
    const normalized = groupId.trim();
    if (!normalized) {
      return;
    }

    if (isLikelyFilePath(normalized)) {
      vscode.window.showWarningMessage('That looks like a file path. Set the shared JSON file path with GhostChat: Set Shared File Path, then enter a simple group name such as TEAM-Alpha.');
      return;
    }

    this.activeGroupId = normalized;
    await this.context.workspaceState.update(STORAGE_KEYS.activeGroupId, normalized);
    await this.markSetupComplete();
    await this.registerActiveGroup(normalized);
    this.updateStatusBar();

    if (this.store) {
      await this.refreshStateFromDisk(true);
    }

    vscode.window.showInformationMessage(`GhostChat active group set to ${normalized}`);
  }

  private async registerActiveGroup(groupId: string): Promise<void> {
    if (!this.store && !this.remoteHostUrl) {
      return;
    }

    const normalized = groupId.trim();
    if (!normalized) {
      return;
    }

    try {
      const records = this.remoteHostUrl ? await this.fetchRemoteEntries() : await this.store!.readEntries();
      const alreadyPresent = records.some((record) => {
        if (!('kind' in record)) {
          return record.groupId === normalized;
        }

        return record.kind === 'group' && record.groupId === normalized;
      });

      if (alreadyPresent) {
        return;
      }

      const record: GhostChatGroupRecord = {
        kind: 'group',
        id: generateMessageId(),
        groupId: normalized,
        sender: this.senderName,
        timestamp: formatTimestampForStorage(new Date())
      };

      if (this.remoteHostUrl) {
        await this.httpPostJson(`${this.remoteHostUrl}/group`, record);
      } else {
        await this.store!.appendGroupRecord(record);
      }
    } catch (error) {
      vscode.window.showErrorMessage(friendlyFsMessage(error));
    }
  }

  private async showSharedGroupsDiagnostics(): Promise<void> {
    const pathLabel = this.sharedFilePath ?? '(not set)';

    if (!this.store) {
      vscode.window.showInformationMessage(`GhostChat diagnostics: shared file path=${pathLabel}, store not initialized, active group=${this.activeGroupId ?? '(none)'}`);
      return;
    }

    try {
      const entries = await this.store.readEntries();
      const groups = [...new Set(entries.map((entry) => entry.groupId.trim()).filter((groupId) => groupId))].sort((left, right) => left.localeCompare(right));
      vscode.window.showInformationMessage(`GhostChat diagnostics: path=${pathLabel}; entries=${entries.length}; groups=${groups.length ? groups.join(', ') : '(none)'}; active=${this.activeGroupId ?? '(none)'}`);
    } catch (error) {
      vscode.window.showErrorMessage(`GhostChat diagnostics failed for ${pathLabel}: ${friendlyFsMessage(error)}`);
    }
  }

  private async startHostShare(): Promise<void> {
    if (this.hostServer) {
      vscode.window.showInformationMessage(`Host already running on port ${this.hostPort}`);
      return;
    }

    if (!this.sharedFilePath) {
      const storageRoot = this.context.globalStorageUri.fsPath;
      this.sharedFilePath = path.join(storageRoot, 'ghostchat_history.json');
      await this.context.workspaceState.update(STORAGE_KEYS.sharedFilePath, this.sharedFilePath);
    }

    await this.attachStore();

    if (!this.activeGroupId) {
      await this.setActiveGroup(generateGroupId());
    }

    const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
      try {
        if (req.method === 'GET' && req.url === '/history') {
          const entries = await this.store?.readEntries() ?? [];
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(entries));
          return;
        }

        if (req.method === 'POST' && req.url === '/message') {
          let body = '';
          for await (const chunk of req) body += chunk;
          const message = JSON.parse(body);
          await this.store?.appendMessage(message);
          res.writeHead(201);
          res.end();
          return;
        }

        if (req.method === 'POST' && req.url === '/group') {
          let body = '';
          for await (const chunk of req) body += chunk;
          const record = JSON.parse(body);
          await this.store?.appendGroupRecord(record);
          res.writeHead(201);
          res.end();
          return;
        }

        if (req.method === 'DELETE' && req.url?.startsWith('/group')) {
          // expect /group?name=GROUPID
          const urlObj = new URL(req.url, `http://localhost`);
          const name = urlObj.searchParams.get('name');
          if (name) await this.store?.deleteGroup(name);
          res.writeHead(204);
          res.end();
          return;
        }

        res.writeHead(404);
        res.end();
      } catch (err) {
        res.writeHead(500);
        res.end(String(err));
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, '0.0.0.0', () => resolve());
      server.on('error', (e: Error) => reject(e));
    });

    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : undefined;
    this.hostServer = server;
    this.hostPort = port;
    const ip = this.getLocalIp();
    await this.markSetupComplete();
    vscode.window.showInformationMessage(`GhostChat host started on port ${port}. Share http://${ip}:${port}`);
    // start broadcasting presence on UDP so clients can discover this host
    try {
      const sock = dgram.createSocket('udp4');
      sock.bind(() => {
        try { sock.setBroadcast(true); } catch { }
      });

      const payload = () => JSON.stringify({ type: 'ghostchat', port: this.hostPort, url: `http://${ip}:${this.hostPort}`, label: `GhostChat@${ip}` });

      this.broadcasterInterval = setInterval(() => {
        try {
          const message = Buffer.from(payload());
          sock.send(message, 0, message.length, this.broadcastPort, '255.255.255.255');
        } catch {
          // ignore send errors
        }
      }, 3000);
    } catch {
      // ignore broadcast failures
    }
    this.updateStatusBar();
  }

  private async stopHostShare(): Promise<void> {
    if (!this.hostServer) {
      vscode.window.showInformationMessage('GhostChat host is not running.');
      return;
    }

    await new Promise<void>((resolve) => this.hostServer!.close(() => resolve()));
    this.hostServer = undefined;
    this.hostPort = undefined;
    vscode.window.showInformationMessage('GhostChat host stopped.');
    this.updateStatusBar();
  }

  private async connectToHost(): Promise<void> {
    // offer discovered hosts first to avoid manual typing
    const discovered = [...this.discoveredHosts.values()];
    let chosenUrl: string | undefined;

    if (discovered.length > 0) {
      const items = discovered.map((d) => ({ label: d.label ?? d.url, description: d.url }));
      items.unshift({ label: 'Enter URL manually...', description: '' });
      const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Choose a Host to connect or enter URL manually' });
      if (!pick) return;
      if (pick.label === 'Enter URL manually...') {
        const value = await vscode.window.showInputBox({ prompt: 'Enter host base URL (e.g. http://192.168.0.151:PORT)', ignoreFocusOut: true });
        if (!value) return;
        chosenUrl = value.trim().replace(/\/$/, '');
      } else {
        chosenUrl = pick.description || pick.label;
      }
    } else {
      const value = await vscode.window.showInputBox({ prompt: 'Enter host base URL (e.g. http://192.168.0.151:PORT)', ignoreFocusOut: true });
      if (!value) return;
      chosenUrl = value.trim().replace(/\/$/, '');
    }

    if (!chosenUrl) return;
    this.remoteHostUrl = chosenUrl;
    await this.context.workspaceState.update('ghostchat.remoteHostUrl', this.remoteHostUrl);
    await this.markSetupComplete();
    vscode.window.showInformationMessage(`GhostChat: connected to host ${this.remoteHostUrl}`);
    this.updateStatusBar();
    await this.showGroupsInLan();
  }

  private async fetchRemoteEntries(): Promise<any[]> {
    if (!this.remoteHostUrl) return [];
    return await this.httpGetJson(`${this.remoteHostUrl}/history`);
  }

  private async postRemoteMessage(message: GhostChatMessage): Promise<void> {
    if (!this.remoteHostUrl) throw new Error('not connected');
    await this.httpPostJson(`${this.remoteHostUrl}/message`, message);
  }

  private async httpGetJson(urlStr: string): Promise<any> {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const req = lib.get(url, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data || '[]'));
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
    });
  }

  private async httpPostJson(urlStr: string, payload: unknown): Promise<void> {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;
    const body = JSON.stringify(payload);

    return new Promise((resolve, reject) => {
      const opts: any = {
        method: 'POST',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + (url.search || ''),
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      };

      const req = lib.request(opts, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (c) => data += c);
          res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${data}`)));
        }
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private async httpDeleteJson(urlStr: string): Promise<void> {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
      const opts: any = {
        method: 'DELETE',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + (url.search || '')
      };

      const req = lib.request(opts, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (c) => data += c);
          res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${data}`)));
        }
      });

      req.on('error', reject);
      req.end();
    });
  }

  private getLocalIp(): string {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      const list = nets[name] ?? [];
      for (const net of list) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
    return '127.0.0.1';
  }

  private async dumpSharedFileContents(): Promise<void> {
    if (!this.store) {
      vscode.window.showInformationMessage('GhostChat store is not initialized. Set the shared file path first.');
      return;
    }

    try {
      const entries = await this.store.readEntries();
      const content = JSON.stringify(entries, null, 2);
      const doc = await vscode.workspace.openTextDocument({ content, language: 'json' });
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (error) {
      vscode.window.showErrorMessage(`GhostChat: failed to open shared file: ${friendlyFsMessage(error)}`);
    }
  }

  private async deleteGroupInteractive(): Promise<void> {
    if (!this.store && !this.remoteHostUrl) {
      vscode.window.showInformationMessage('GhostChat store is not initialized. Set the shared file path first.');
      return;
    }

    const groups = await this.getKnownGroups();
    if (groups.length === 0) {
      vscode.window.showInformationMessage('No groups available to delete.');
      return;
    }

    const pick = await vscode.window.showQuickPick(groups.map((g) => ({ label: g })), { placeHolder: 'Select group to delete' });
    if (!pick) return;

    const confirmed = await vscode.window.showWarningMessage(`Delete group ${pick.label} and all its records? This cannot be undone.`, { modal: true }, 'Delete');
    if (confirmed !== 'Delete') return;

    try {
      if (this.remoteHostUrl) {
        await this.httpDeleteJson(`${this.remoteHostUrl}/group?name=${encodeURIComponent(pick.label)}`);
      } else {
        await this.store!.deleteGroup(pick.label);
      }
      vscode.window.showInformationMessage(`GhostChat: group ${pick.label} deleted from shared file.`);
      await this.refreshStateFromDisk(true);
    } catch (error) {
      vscode.window.showErrorMessage(`GhostChat: failed to delete group ${pick.label}: ${friendlyFsMessage(error)}`);
    }
  }

  private async getKnownGroups(): Promise<string[]> {
    if (this.remoteHostUrl) {
      try {
        const entries = await this.fetchRemoteEntries();
        const unique = new Set<string>();
        for (const e of entries) {
          if (e.groupId && String(e.groupId).trim()) unique.add(String(e.groupId).trim());
        }
        if (this.activeGroupId) unique.add(this.activeGroupId);
        return [...unique].sort((l, r) => l.localeCompare(r));
      } catch (err) {
        vscode.window.showErrorMessage(`GhostChat remote read failed: ${String(err)}`);
        return this.activeGroupId ? [this.activeGroupId] : [];
      }
    }

    if (!this.store) {
      return this.activeGroupId ? [this.activeGroupId] : [];
    }

    try {
      const unique = new Set<string>();
      const entries = await this.store.readEntries();

      for (const entry of entries) {
        if (entry.groupId.trim()) {
          unique.add(entry.groupId.trim());
        }
      }

      if (this.activeGroupId) {
        unique.add(this.activeGroupId);
      }

      return [...unique].sort((left, right) => left.localeCompare(right));
    } catch (error) {
      vscode.window.showErrorMessage(`GhostChat could not read shared groups from ${this.sharedFilePath ?? '(unknown path)'}: ${friendlyFsMessage(error)}`);
      return [];
    }
  }

  private async setSenderName(): Promise<void> {
    const value = await vscode.window.showInputBox({
      prompt: 'Set the sender name used by GhostChat',
      placeHolder: this.senderName,
      value: this.senderName,
      ignoreFocusOut: true,
      validateInput: (input: string) => input.trim() ? undefined : 'Sender name cannot be empty.'
    });

    if (!value) {
      return;
    }

    this.senderName = value.trim();
    await this.context.workspaceState.update(STORAGE_KEYS.senderName, this.senderName);
    this.updateStatusBar();
    vscode.window.showInformationMessage(`GhostChat sender name set to ${this.senderName}`);
  }

  private async sendSelectedText(): Promise<void> {
    if (!this.activeGroupId) {
      vscode.window.showWarningMessage('Set an active Group ID before sending a message.');
      return;
    }

    if (!this.store) {
      vscode.window.showWarningMessage('Set the shared file path before sending a message.');
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Open a file and select some text before sending.');
      return;
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
      vscode.window.showWarningMessage('Select some text before sending a GhostChat message.');
      return;
    }

    const content = editor.document.getText(selection);
    const fileName = path.basename(editor.document.fileName || editor.document.uri.fsPath || 'unknown');
    const lineNumber = selection.start.line + 1;

    const message: GhostChatMessage = {
      id: generateMessageId(),
      groupId: this.activeGroupId,
      sender: this.senderName,
      content,
      file: fileName,
      line: lineNumber,
      timestamp: formatTimestampForStorage(new Date())
    };

    try {
      if (this.remoteHostUrl) {
        await this.postRemoteMessage(message);
      } else {
        await this.store.appendMessage(message);
      }
      this.lastKnownLatestMessageId = message.id;
      this.lastKnownMessageCount += 1;
      this.updateStatusBar();
      vscode.window.showInformationMessage(`Message sent to Group ${this.activeGroupId}`);
    } catch (error) {
      vscode.window.showErrorMessage(friendlyFsMessage(error));
    }
  }

  private async insertHistoryAtCursor(): Promise<void> {
    if (!this.activeGroupId) {
      vscode.window.showWarningMessage('Set an active Group ID before inserting history.');
      return;
    }

    if (!this.store && !this.remoteHostUrl) {
      vscode.window.showWarningMessage('Set the shared file path before inserting history.');
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Open a file and place the cursor where the history should be inserted.');
      return;
    }

    try {
      const messages = this.remoteHostUrl
        ? (await this.fetchRemoteEntries()).filter((entry) => !entry.kind)
        : await this.store!.readMessages();
      const groupMessages = messages.filter((message) => message.groupId === this.activeGroupId);

      if (groupMessages.length === 0) {
        const availableGroups = [...new Set(messages.map((message) => message.groupId).filter((groupId) => groupId && groupId.trim()))].sort((left, right) => left.localeCompare(right));

        if (availableGroups.length > 0) {
          vscode.window.showInformationMessage(`No history found for Group ${this.activeGroupId}. Available groups in the shared file: ${availableGroups.join(', ')}. Use GhostChat: Set Active Group to switch.`);
        } else {
          vscode.window.showInformationMessage(`No history found for Group ${this.activeGroupId}. The shared JSON file is empty or contains no valid messages yet.`);
        }
        return;
      }

      const historyBlock = buildHistoryBlock(groupMessages, this.activeGroupId, editor.document.languageId);
      const insertionPosition = editor.selection.active;

      await editor.edit((editBuilder) => {
        editBuilder.insert(insertionPosition, historyBlock);
      });

      vscode.window.showInformationMessage('Full history inserted at cursor. Delete this block when done.');
    } catch (error) {
      vscode.window.showErrorMessage(friendlyFsMessage(error));
    }
  }
}