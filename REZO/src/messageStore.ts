import * as vscode from 'vscode';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GhostMessage {
  id: string;
  roomCode: string;
  sender: string;
  content: string;
  file: string;
  line: number;
  timestamp: number;
}

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
  const stored = context.workspaceState.get<string>(KEY_DISPLAY_NAME);
  if (stored && stored.trim().length > 0) {
    return stored.trim();
  }
  // Fallback to OS username
  return os.userInfo().username || 'user';
}

/**
 * Persist a new display name.
 */
export async function setDisplayName(
  context: vscode.ExtensionContext,
  name: string
): Promise<void> {
  await context.workspaceState.update(KEY_DISPLAY_NAME, name.trim());
}

// ---------------------------------------------------------------------------
// Local message cache
// ---------------------------------------------------------------------------

type CacheStore = Record<string, GhostMessage[]>;

/**
 * Save up to MAX_CACHE_SIZE messages for a room into workspaceState.
 */
export async function cacheMessages(
  context: vscode.ExtensionContext,
  roomCode: string,
  messages: GhostMessage[]
): Promise<void> {
  const cache = context.workspaceState.get<CacheStore>(KEY_MESSAGE_CACHE) ?? {};
  // Keep only the last MAX_CACHE_SIZE
  cache[roomCode] = messages.slice(-MAX_CACHE_SIZE);
  await context.workspaceState.update(KEY_MESSAGE_CACHE, cache);
}

/**
 * Retrieve cached messages for a room, or empty array if none.
 */
export function getCachedMessages(
  context: vscode.ExtensionContext,
  roomCode: string
): GhostMessage[] {
  const cache = context.workspaceState.get<CacheStore>(KEY_MESSAGE_CACHE) ?? {};
  return cache[roomCode] ?? [];
}

// ---------------------------------------------------------------------------
// Comment style detection
// ---------------------------------------------------------------------------

/**
 * Return the appropriate comment style for a given VS Code language ID.
 */
export function getCommentStyle(languageId: string): CommentStyle {
  // Languages that use # line comments
  const hashComment = [
    'python',
    'ruby',
    'shellscript',
    'bash',
    'sh',
    'powershell',
    'yaml',
    'toml',
    'dockerfile',
    'makefile',
    'perl',
    'r',
    'coffeescript',
    'elixir',
    'julia',
    'crystal',
  ];

  // Languages that use <!-- --> block comments
  const htmlComment = [
    'html',
    'xml',
    'svg',
    'markdown',
    'vue',
    'htmldjango',
    'handlebars',
  ];

  // Languages that use -- line comments (SQL, Lua, Haskell)
  const dashComment = ['sql', 'lua', 'haskell'];

  // Languages that use % comments (LaTeX, Erlang)
  const percentComment = ['latex', 'erlang', 'tex'];

  if (hashComment.includes(languageId)) {
    return {
      linePrefix: '# ',
      blockStart: '# ',
      blockEnd: '# ',
      useBlock: false,
    };
  }

  if (htmlComment.includes(languageId)) {
    return {
      linePrefix: '',
      blockStart: '<!-- ',
      blockEnd: ' -->',
      useBlock: true,
    };
  }

  if (dashComment.includes(languageId)) {
    return {
      linePrefix: '-- ',
      blockStart: '-- ',
      blockEnd: '-- ',
      useBlock: false,
    };
  }

  if (percentComment.includes(languageId)) {
    return {
      linePrefix: '% ',
      blockStart: '% ',
      blockEnd: '% ',
      useBlock: false,
    };
  }

  // Default: C-style // comments (TypeScript, JavaScript, Java, C, C++, Go, Rust, Swift, etc.)
  return {
    linePrefix: '// ',
    blockStart: '// ',
    blockEnd: '// ',
    useBlock: false,
  };
}

// ---------------------------------------------------------------------------
// History block formatting
// ---------------------------------------------------------------------------

/**
 * Format a timestamp number into a human-readable date/time string.
 * e.g. "2024-01-15 14:30"
 */
function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * Build the REZO HISTORY comment block for insertion at cursor.
 *
 * For line-comment languages:
 *   // ===== REZO HISTORY [Room: REZO-7K9P] =====
 *   // [2024-01-15 14:30] alice (utils.ts:42): check this function
 *   // ===== END REZO HISTORY =====
 *
 * For HTML/XML:
 *   <!-- ===== REZO HISTORY [Room: REZO-7K9P] ===== -->
 *   <!-- [2024-01-15 14:30] alice (utils.ts:42): check this function -->
 *   <!-- ===== END REZO HISTORY ===== -->
 */
export function formatHistoryBlock(
  messages: GhostMessage[],
  roomCode: string,
  languageId: string
): string {
  const style = getCommentStyle(languageId);

  const lines: string[] = [];

  if (style.useBlock) {
    // HTML-style: each line is its own <!-- ... -->
    lines.push(`${style.blockStart}===== REZO HISTORY [Room: ${roomCode}] =====${style.blockEnd}`);

    if (messages.length === 0) {
      lines.push(`${style.blockStart}(no messages in this room)${style.blockEnd}`);
    } else {
      for (const msg of messages) {
        const ts = formatTimestamp(msg.timestamp);
        const loc = msg.file ? `${msg.file}:${msg.line}` : '(unknown)';
        lines.push(
          `${style.blockStart}[${ts}] ${msg.sender} (${loc}): ${msg.content}${style.blockEnd}`
        );
      }
    }

    lines.push(`${style.blockStart}===== END REZO HISTORY =====${style.blockEnd}`);
  } else {
    // Line-comment style (// or # or -- etc.)
    const p = style.linePrefix;
    lines.push(`${p}===== REZO HISTORY [Room: ${roomCode}] =====`);

    if (messages.length === 0) {
      lines.push(`${p}(no messages in this room)`);
    } else {
      for (const msg of messages) {
        const ts = formatTimestamp(msg.timestamp);
        const loc = msg.file ? `${msg.file}:${msg.line}` : '(unknown)';
        lines.push(`${p}[${ts}] ${msg.sender} (${loc}): ${msg.content}`);
      }
    }

    lines.push(`${p}===== END REZO HISTORY =====`);
  }

  return lines.join('\n') + '\n';
}
