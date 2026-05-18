import * as fs from 'fs';
import * as path from 'path';

export interface GhostChatMessage {
  id: string;
  groupId: string;
  sender: string;
  content: string;
  file: string;
  line: number;
  timestamp: string;
}

export interface GhostChatGroupRecord {
  kind: 'group';
  id: string;
  groupId: string;
  sender: string;
  timestamp: string;
}

export type GhostChatRecord = GhostChatMessage | GhostChatGroupRecord;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryableFsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  if (error instanceof SyntaxError) {
    return true;
  }

  const message = error instanceof Error ? error.message : '';
  if (message.includes('Unexpected end of JSON input') || message.includes('Unexpected token')) {
    return true;
  }

  const code = (error as { code?: string }).code;
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' || code === 'ETIMEDOUT' || code === 'ENOTEMPTY' || code === 'ENOENT';
}

async function withRetries<T>(operation: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryableFsError(error)) {
        throw error;
      }

      await sleep(100 * attempt);
    }
  }

  throw lastError;
}

function isGhostChatMessage(candidate: unknown): candidate is GhostChatMessage {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }

  const message = candidate as Partial<GhostChatMessage>;
  return typeof message.id === 'string'
    && typeof message.groupId === 'string'
    && typeof message.sender === 'string'
    && typeof message.content === 'string'
    && typeof message.file === 'string'
    && typeof message.line === 'number'
    && typeof message.timestamp === 'string';
}

function isGhostChatGroupRecord(candidate: unknown): candidate is GhostChatGroupRecord {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }

  const record = candidate as Partial<GhostChatGroupRecord>;
  return record.kind === 'group'
    && typeof record.id === 'string'
    && typeof record.groupId === 'string'
    && typeof record.sender === 'string'
    && typeof record.timestamp === 'string';
}

export class SharedHistoryStore {
  constructor(private readonly sharedFilePath: string) {}

  public get filePath(): string {
    return this.sharedFilePath;
  }

  public async ensureReady(): Promise<void> {
    const directory = path.dirname(this.sharedFilePath);
    await fs.promises.mkdir(directory, { recursive: true });

    try {
      await fs.promises.access(this.sharedFilePath, fs.constants.F_OK);
    } catch {
      await fs.promises.writeFile(this.sharedFilePath, '[]', 'utf8');
    }
  }

  public async readMessages(): Promise<GhostChatMessage[]> {
    const entries = await this.readEntries();

    return entries.filter(isGhostChatMessage);
  }

  public async readEntries(): Promise<GhostChatRecord[]> {
    await this.ensureReady();

    return withRetries(async () => {
      const raw = await fs.promises.readFile(this.sharedFilePath, 'utf8');
      const trimmed = raw.trim();

      if (!trimmed) {
        return [];
      }

      const parsed: unknown = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        throw new Error('GhostChat history file must contain a JSON array.');
      }

      const records = parsed.filter((candidate): candidate is GhostChatRecord => isGhostChatMessage(candidate) || isGhostChatGroupRecord(candidate));
      return records;
    });
  }

  public async appendMessage(message: GhostChatMessage): Promise<void> {
    await this.ensureReady();

    await withRetries(async () => {
      const entries = await this.readEntries();
      entries.push(message);
      await fs.promises.writeFile(this.sharedFilePath, JSON.stringify(entries, null, 2), 'utf8');
    });
  }

  public async appendGroupRecord(record: GhostChatGroupRecord): Promise<void> {
    await this.ensureReady();

    await withRetries(async () => {
      const entries = await this.readEntries();
      entries.push(record);
      await fs.promises.writeFile(this.sharedFilePath, JSON.stringify(entries, null, 2), 'utf8');
    });
  }

  public async deleteGroup(groupId: string): Promise<void> {
    await this.ensureReady();

    await withRetries(async () => {
      const entries = await this.readEntries();
      const filtered = entries.filter((entry) => entry.groupId !== groupId);
      await fs.promises.writeFile(this.sharedFilePath, JSON.stringify(filtered, null, 2), 'utf8');
    });
  }

  public watch(onChange: () => void): { close: () => void } {
    let watcher: any;
    try {
      // fs.watch often fails silently on network drives, but we can still try it
      // as a fast-path for local files.
      watcher = fs.watch(this.sharedFilePath, { persistent: false }, (eventType: string) => {
        if (eventType === 'change') {
          onChange();
        }
      });
    } catch {
      // Ignore watch initialization errors
    }

    // Always use fs.watchFile (polling) as a fallback for network shares (SMB/CIFS)
    // because Windows/Ubuntu cross-system file events do not trigger fs.watch reliably.
    const pollListener = (curr: any, prev: any) => {
      if (curr.mtimeMs !== prev.mtimeMs || curr.size !== prev.size) {
        onChange();
      }
    };

    fs.watchFile(this.sharedFilePath, { interval: 1000 }, pollListener);

    return {
      close: () => {
        if (watcher) {
          watcher.close();
        }
        fs.unwatchFile(this.sharedFilePath, pollListener);
      }
    };
  }
}