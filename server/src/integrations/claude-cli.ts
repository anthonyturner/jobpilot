import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 6 * 60_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

/** Every built-in tool that could touch disk, shell or the open web. */
export const ALL_BUILTIN_TOOLS = 'Bash,PowerShell,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,NotebookEdit,Task,Agent';

/** `--setting-sources ""`: skip user/project settings (hooks, plugins). */
export const NO_SETTINGS = '';

/** An empty-string argument (e.g. `--tools ""` to disable every built-in tool). */
export const EMPTY_ARG = '';

/**
 * On Windows, npm installs `claude` as a .cmd shim around claude.exe. Launching the
 * .exe directly means no shell is involved, so arguments are passed verbatim and
 * nothing can be shell-interpreted.
 */
export function resolveClaudeExecutable(bin: string): string {
  if (process.platform !== 'win32' || path.isAbsolute(bin) && bin.toLowerCase().endsWith('.exe')) return bin;
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const exe = path.join(dir, `${bin}.exe`);
    if (fs.existsSync(exe)) return exe;
    const shim = path.join(dir, `${bin}.cmd`);
    if (fs.existsSync(shim)) {
      const target = fs.readFileSync(shim, 'utf8').match(/"%dp0%\\([^"]+\.exe)"/i)?.[1];
      if (target && fs.existsSync(path.join(dir, target))) return path.join(dir, target);
    }
  }
  throw new Error(`Could not find the Claude Code executable "${bin}". Set CLAUDE_BIN to the full path of claude.exe.`);
}

export interface ClaudeRunner {
  run(prompt: string, args: string[], timeoutMs?: number): Promise<string>;
}

/** Runs `claude -p` with the prompt on stdin (never in argv, so nothing is shell-interpreted). */
export class ClaudeCliRunner implements ClaudeRunner {
  private resolved: string | null = null;

  constructor(
    private readonly bin: string,
    private readonly cwd: string,
  ) {}

  run(prompt: string, args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        this.resolved ??= resolveClaudeExecutable(this.bin);
      } catch (error) {
        reject(error);
        return;
      }
      const child = spawn(this.resolved, args, {
        cwd: this.cwd,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Claude Code timed out'));
      }, timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        if (stdout.length > MAX_OUTPUT_BYTES) child.kill();
      });
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8').slice(0, 4000)));
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(new Error(`Could not start Claude Code (${error.message}). Is CLAUDE_BIN correct?`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new Error(`Claude Code exited with code ${code}: ${stderr.trim().slice(0, 300)}`));
      });
      child.stdin.end(prompt, 'utf8');
    });
  }
}
