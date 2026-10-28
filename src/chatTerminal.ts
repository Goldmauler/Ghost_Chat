import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// ChatTerminal — REZO's "hidden in plain sight" chat surface.
//
// Instead of a chat panel, messages flow through a VS Code pseudoterminal that
// is disguised as an ordinary shell (node / bash / python / powershell). You
// type a message like a command and press Enter to send; incoming messages
// scroll in like command output. To a shoulder-surfer it reads as normal
// terminal work — no chat bubbles, no sidebar.
//
// This is a pure UI shell: it knows nothing about Firebase or encryption. It
// calls `onSend(text)` when the user submits a line and renders whatever the
// extension pushes via `writeIncoming`.
// ---------------------------------------------------------------------------

export interface ChatLine {
  sender: string;
  content: string;
  self: boolean;
  ts: number;
}

interface Disguise {
  name: string;
  prompt: string;
  banner: string;
}

const DISGUISES: Record<string, Disguise> = {
  node: { name: 'node', prompt: '> ', banner: 'Welcome to Node.js v20.11.0.\r\nType ".help" for more information.' },
  bash: { name: 'bash', prompt: '$ ', banner: '' },
  zsh: { name: 'zsh', prompt: '% ', banner: '' },
  python: { name: 'python', prompt: '>>> ', banner: 'Python 3.12.1 (main)\r\nType "help", "copyright", "credits" or "license" for more information.' },
  powershell: { name: 'pwsh', prompt: 'PS> ', banner: '' },
};

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
};

export class ChatTerminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  private terminal: vscode.Terminal | undefined;
  private input = '';
  private opened = false;
  private readonly disguise: Disguise;
  private readonly closeSub: vscode.Disposable;

  constructor(
    disguiseKey: string,
    private readonly onSend: (text: string) => void,
    private readonly roomLabel: () => string,
    private readonly onUserClose: () => void,
    private readonly backlog: () => ChatLine[]
  ) {
    this.disguise = DISGUISES[disguiseKey] ?? DISGUISES.node;

    // If the user closes the terminal by hand, drop our reference.
    this.closeSub = vscode.window.onDidCloseTerminal((t) => {
      if (t === this.terminal) {
        this.terminal = undefined;
        this.opened = false;
        this.onUserClose();
      }
    });
  }

  public get isOpen(): boolean {
    return this.opened;
  }

  /** Create (or reveal) the disguised terminal and focus it. */
  public open(): void {
    if (this.terminal) {
      this.terminal.show();
      return;
    }

    const pty: vscode.Pseudoterminal = {
      onDidWrite: this.writeEmitter.event,
      open: () => {
        this.opened = true;
        if (this.disguise.banner) this.write(this.disguise.banner + '\r\n');
        this.write(
          `${C.dim}// REZO ${this.roomLabel()} — type a message and press Enter. Ctrl+C clears the line.${C.reset}\r\n`
        );
        for (const line of this.backlog()) {
          this.write(this.formatLine(line) + '\r\n');
        }
        this.redrawPrompt();
      },
      close: () => {
        this.opened = false;
      },
      handleInput: (data) => this.handleInput(data),
    };

    this.terminal = vscode.window.createTerminal({ name: this.disguise.name, pty });
    this.terminal.show();
  }

  /** Render an incoming (or echoed) message above the prompt. */
  public writeIncoming(line: ChatLine): void {
    if (!this.opened) return;
    // Erase the current prompt+input line, print the message, restore prompt.
    this.write('\r\x1b[2K');
    this.write(this.formatLine(line) + '\r\n');
    this.redrawPrompt();
  }

  /** Print a dim system note (e.g. "3 online") without disrupting input. */
  public writeNote(text: string): void {
    if (!this.opened) return;
    this.write('\r\x1b[2K');
    this.write(`${C.dim}${text}${C.reset}\r\n`);
    this.redrawPrompt();
  }

  public dispose(): void {
    this.closeSub.dispose();
    if (this.terminal) {
      const t = this.terminal;
      this.terminal = undefined;
      this.opened = false;
      t.dispose();
    }
    this.writeEmitter.dispose();
  }

  // --- internals ----------------------------------------------------------

  private write(s: string): void {
    this.writeEmitter.fire(s);
  }

  private redrawPrompt(): void {
    this.write('\r\x1b[2K' + this.disguise.prompt + this.input);
  }

  private formatLine(line: ChatLine): string {
    const time = new Date(line.ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    const who = line.self
      ? `${C.green}${line.sender}${C.reset}`
      : `${C.cyan}${line.sender}${C.reset}`;
    return `${C.dim}${time}${C.reset} ${who} ${line.content}`;
  }

  private handleInput(data: string): void {
    // Ignore escape sequences (arrow keys, function keys, etc.).
    if (data.startsWith('\x1b')) return;

    for (const ch of data) {
      const code = ch.charCodeAt(0);

      if (ch === '\r' || ch === '\n') {
        this.submit();
      } else if (ch === '\x7f' || ch === '\b') {
        if (this.input.length > 0) {
          this.input = this.input.slice(0, -1);
          this.write('\b \b');
        }
      } else if (ch === '\x03') {
        // Ctrl+C — abandon the current line.
        this.input = '';
        this.write('^C\r\n');
        this.redrawPrompt();
      } else if (code >= 0x20) {
        this.input += ch;
        this.write(ch);
      }
    }
  }

  private submit(): void {
    const text = this.input.trim();
    this.input = '';
    this.write('\r\n');
    if (text.length > 0) {
      this.onSend(text);
    }
    this.redrawPrompt();
  }
}
