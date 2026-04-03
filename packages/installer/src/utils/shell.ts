import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCb);

export interface ShellResult {
  stdout: string;
  stderr: string;
}

/**
 * Execute a command safely using execFile (no shell interpolation).
 * SECURITY: Uses execFile instead of exec to prevent shell injection.
 */
export async function shell(cmd: string, args: string[] = []): Promise<ShellResult> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      throw new Error(`Command not found: ${cmd}`);
    }
    throw err;
  }
}

export async function commandExists(cmd: string): Promise<boolean> {
  try {
    await shell(cmd, ['--version']);
    return true;
  } catch {
    return false;
  }
}

export function getPlatform(): 'windows' | 'macos' | 'linux' {
  switch (process.platform) {
    case 'win32': return 'windows';
    case 'darwin': return 'macos';
    default: return 'linux';
  }
}
