import * as vscode from 'vscode';
import * as path from 'path';
import { GhostMessage } from './messageStore';

// ---------------------------------------------------------------------------
// RezoCommentController — renders REZO messages as native VS Code comment
// threads attached to the (file, line) they were sent against, instead of
// rewriting the user's source file with a `// =====` block.
//
// Indexing:
//   `${basename}:${line}`  →  { thread, messages[] }
//
// Why basename, not absolute path: senders only ever record the file's
// basename (`utils.ts`), not the full path, so matching has to ignore the
// directory. This is intentional — different teammates' checkouts live in
// different places. Trade-off: identical filenames in two folders share a
// thread. Acceptable for v2.0; revisit when threads gain workspace-relative
// paths.
// ---------------------------------------------------------------------------

const REPLY_CONTEXT = 'rezoThread';

export class RezoCommentController {
  private readonly controller: vscode.CommentController;
  /** Map basename → line → thread */
  private readonly threadsByFile = new Map<string, Map<number, vscode.CommentThread>>();
  /** All known messages, grouped by `${basename}:${line}` */
  private readonly bucket = new Map<string, GhostMessage[]>();
  /** Active editor watcher disposable */
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly nameProvider: () => string,
    private readonly sendReply: (parent: GhostMessage, content: string) => Promise<GhostMessage | undefined>,
    private readonly logger: vscode.OutputChannel
  ) {
    this.controller = vscode.comments.createCommentController(
      'rezo',
      'REZO room threads'
    );

    // Without commentingRangeProvider, "Start thread on this line" UI never
    // appears. We allow it on every line of every editor — the actual send
    // still goes through `rezo.pinSelection` which records file+line, so the
    // reply path is the same code path.
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: (doc) => [
        new vscode.Range(0, 0, Math.max(0, doc.lineCount - 1), 0)
      ]
    };

    // Re-attach threads when the user opens a different file.
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(() => this.reattachAll())
    );
  }

  /**
   * Replace the entire known message set. Used after the initial Firebase
   * fetch on join / after a network reconnect.
   */
  public setMessages(messages: GhostMessage[]): void {
    this.bucket.clear();
    for (const m of messages) {
      this.addToBucket(m);
    }
    this.rebuildAll();
  }

  /**
   * Add a single incoming message (from SSE).
   */
  public addMessage(msg: GhostMessage): void {
    // Only pinned messages (with a file + line) become review threads.
    if (!msg.file || typeof msg.line !== 'number') return;
    this.addToBucket(msg);
    const key = `${msg.file}:${msg.line}`;
    const list = this.bucket.get(key);
    if (!list) return;
    this.renderBucket(msg.file, msg.line, list);
  }

  public clear(): void {
    for (const fileMap of this.threadsByFile.values()) {
      for (const thread of fileMap.values()) {
        thread.dispose();
      }
    }
    this.threadsByFile.clear();
    this.bucket.clear();
  }

  public dispose(): void {
    this.clear();
    for (const d of this.disposables) d.dispose();
    this.controller.dispose();
  }

  // --- internals ----------------------------------------------------------

  private addToBucket(m: GhostMessage): void {
    if (!m.file || typeof m.line !== 'number') return;
    const key = `${m.file}:${m.line}`;
    const list = this.bucket.get(key) ?? [];
    // Dedup by id — SSE replays the snapshot on reconnect
    if (!list.some((x) => x.id === m.id)) {
      list.push(m);
      list.sort((a, b) => a.timestamp - b.timestamp);
    }
    this.bucket.set(key, list);
  }

  private rebuildAll(): void {
    // Dispose existing threads so we don't leak when bucket order changes.
    for (const fileMap of this.threadsByFile.values()) {
      for (const thread of fileMap.values()) thread.dispose();
    }
    this.threadsByFile.clear();

    for (const [key, list] of this.bucket) {
      const split = key.lastIndexOf(':');
      if (split === -1) continue;
      const file = key.slice(0, split);
      const line = Number(key.slice(split + 1));
      if (!Number.isFinite(line)) continue;
      this.renderBucket(file, line, list);
    }
  }

  private reattachAll(): void {
    // Editors changed — make sure each visible doc has its threads.
    for (const [key, list] of this.bucket) {
      const split = key.lastIndexOf(':');
      if (split === -1) continue;
      const file = key.slice(0, split);
      const line = Number(key.slice(split + 1));
      if (!Number.isFinite(line)) continue;
      const fileMap = this.threadsByFile.get(file);
      const existing = fileMap?.get(line);
      if (existing) continue;
      this.renderBucket(file, line, list);
    }
  }

  /**
   * Find an open document whose basename matches `file`. If none is open we
   * skip creating a thread — it'll be created next time the user opens that
   * file (via `onDidChangeVisibleTextEditors`).
   */
  private findUri(file: string): vscode.Uri | null {
    for (const editor of vscode.window.visibleTextEditors) {
      if (path.basename(editor.document.fileName) === file) {
        return editor.document.uri;
      }
    }
    for (const doc of vscode.workspace.textDocuments) {
      if (path.basename(doc.fileName) === file) {
        return doc.uri;
      }
    }
    return null;
  }

  private renderBucket(file: string, line: number, list: GhostMessage[]): void {
    if (list.length === 0) return;
    const uri = this.findUri(file);
    if (!uri) return;

    // VS Code lines are 0-based; messages store 1-based.
    const lineIdx = Math.max(0, line - 1);
    const range = new vscode.Range(lineIdx, 0, lineIdx, 0);

    let fileMap = this.threadsByFile.get(file);
    if (!fileMap) {
      fileMap = new Map();
      this.threadsByFile.set(file, fileMap);
    }

    const existing = fileMap.get(line);
    if (existing) existing.dispose();

    const comments = list.map((m) => this.toComment(m));
    const thread = this.controller.createCommentThread(uri, range, comments);
    thread.label = `REZO (${list.length})`;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
    thread.canReply = true;
    thread.contextValue = REPLY_CONTEXT;
    fileMap.set(line, thread);
  }

  private toComment(m: GhostMessage): vscode.Comment {
    const bodyParts: string[] = [m.content];
    if (m.commitShort) {
      const branch = m.branch ? `${m.branch} · ` : '';
      const dirty = m.dirty ? ' (uncommitted changes)' : '';
      bodyParts.push(`\n\n*${branch}\`${m.commitShort}\`${dirty}*`);
    }
    const body = new vscode.MarkdownString(bodyParts.join(''));
    body.isTrusted = false;
    body.supportHtml = false;

    return {
      body,
      mode: vscode.CommentMode.Preview,
      author: { name: m.sender },
      timestamp: new Date(m.timestamp),
      contextValue: 'rezoComment'
    };
  }

  /**
   * Public hook used by the `rezo.replyThread` command. Finds the parent
   * message for the given thread and forwards the reply to the caller.
   */
  public async reply(thread: vscode.CommentThread, content: string): Promise<void> {
    if (!content.trim()) return;
    // Find the parent message: first message in the thread.
    const fileMap = this.findMapForThread(thread);
    if (!fileMap) return;
    const parentList = fileMap;
    if (parentList.length === 0) return;
    const parent = parentList[0];
    const sent = await this.sendReply(parent, content.trim());
    // Local append for instant feedback. It carries the real message id, so
    // the SSE echo of the same message is deduped instead of shown twice.
    if (sent) this.addMessage(sent);
  }

  private findMapForThread(thread: vscode.CommentThread): GhostMessage[] | null {
    for (const [file, fileMap] of this.threadsByFile) {
      for (const [line, t] of fileMap) {
        // Match on file AND line: two files can both have a thread on line 10.
        if (t === thread) return this.bucket.get(`${file}:${line}`) ?? null;
      }
    }
    return null;
  }
}
