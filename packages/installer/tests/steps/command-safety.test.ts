import { describe, it, expect } from 'vitest';
import {
  buildWarmupCommand,
  buildSshExecCommand,
  buildScpCommand,
  buildSshExecScriptCommand,
} from '../../src/steps/step-vm-setup.js';
import { assertCmdExeSafe } from '../../src/utils/cmd-safety.js';

const PROJECT = 'test-project';
const ZONE = 'us-east1-b';

describe('Command string safety for cmd.exe', () => {
  describe('buildWarmupCommand', () => {
    it('generates a cmd.exe-safe command', () => {
      const cmd = buildWarmupCommand(PROJECT, ZONE);
      assertCmdExeSafe(cmd);
    });

    it('uses --command=true (no spaces)', () => {
      const cmd = buildWarmupCommand(PROJECT, ZONE);
      expect(cmd).toContain('--command=true');
    });

    it('includes required gcloud SSH flags', () => {
      const cmd = buildWarmupCommand(PROJECT, ZONE);
      expect(cmd).toContain('gcloud compute ssh lox-vm');
      expect(cmd).toContain(`--zone=${ZONE}`);
      expect(cmd).toContain(`--project=${PROJECT}`);
      expect(cmd).toContain('--tunnel-through-iap');
      expect(cmd).toContain('--quiet');
      expect(cmd).toContain('--strict-host-key-checking=no');
    });
  });

  describe('buildSshExecCommand', () => {
    it('generates a cmd.exe-safe command for simple commands', () => {
      const cmd = buildSshExecCommand(PROJECT, ZONE, 'echo hello');
      assertCmdExeSafe(cmd);
    });

    it('double-quotes the --command value', () => {
      const cmd = buildSshExecCommand(PROJECT, ZONE, 'tail -n 10 /var/log/syslog');
      expect(cmd).toMatch(/--command="tail -n 10 \/var\/log\/syslog"/);
    });

    it('rejects commands with && (should use sshExecScript instead)', () => {
      const cmd = buildSshExecCommand(PROJECT, ZONE, 'cmd1 && cmd2');
      expect(() => assertCmdExeSafe(cmd)).toThrow('cmd.exe operator');
    });

    it('rejects commands with || (should use sshExecScript instead)', () => {
      const cmd = buildSshExecCommand(PROJECT, ZONE, 'cmd1 || cmd2');
      expect(() => assertCmdExeSafe(cmd)).toThrow('cmd.exe operator');
    });

    it('rejects commands with pipe (should use sshExecScript instead)', () => {
      const cmd = buildSshExecCommand(PROJECT, ZONE, 'ls | grep foo');
      expect(() => assertCmdExeSafe(cmd)).toThrow('cmd.exe operator');
    });

    it('rejects commands with output redirect', () => {
      const cmd = buildSshExecCommand(PROJECT, ZONE, 'echo hello > /tmp/out');
      expect(() => assertCmdExeSafe(cmd)).toThrow('cmd.exe operator');
    });

    it('rejects commands with input redirect', () => {
      const cmd = buildSshExecCommand(PROJECT, ZONE, 'cat < /tmp/in');
      expect(() => assertCmdExeSafe(cmd)).toThrow('cmd.exe operator');
    });

    it('accepts simple single commands with flags', () => {
      const cmd = buildSshExecCommand(PROJECT, ZONE, 'systemctl status postgresql');
      assertCmdExeSafe(cmd);
    });
  });

  describe('buildScpCommand', () => {
    it('generates a cmd.exe-safe command', () => {
      const cmd = buildScpCommand(PROJECT, ZONE, '/tmp/script.sh', '/tmp/remote.sh');
      assertCmdExeSafe(cmd);
    });

    it('quotes the local path for Windows paths with spaces', () => {
      const cmd = buildScpCommand(PROJECT, ZONE, 'C:\\Users\\Name With Spaces\\file.sh', '/tmp/remote.sh');
      expect(cmd).toContain('"C:\\Users\\Name With Spaces\\file.sh"');
    });

    it('includes required gcloud SCP flags', () => {
      const cmd = buildScpCommand(PROJECT, ZONE, '/tmp/local.sh', '/tmp/remote.sh');
      expect(cmd).toContain('gcloud compute scp');
      expect(cmd).toContain(`--zone=${ZONE}`);
      expect(cmd).toContain(`--project=${PROJECT}`);
      expect(cmd).toContain('--tunnel-through-iap');
      expect(cmd).toContain('--quiet');
    });

    it('formats remote path with VM name prefix', () => {
      const cmd = buildScpCommand(PROJECT, ZONE, '/tmp/local.sh', '/tmp/remote.sh');
      expect(cmd).toContain('lox-vm:/tmp/remote.sh');
    });
  });

  describe('buildSshExecScriptCommand', () => {
    it('generates a cmd.exe-safe command', () => {
      const cmd = buildSshExecScriptCommand(PROJECT, ZONE, '/tmp/lox-setup-abc123.sh');
      assertCmdExeSafe(cmd);
    });

    it('does not include && (cleanup removed per #40)', () => {
      const cmd = buildSshExecScriptCommand(PROJECT, ZONE, '/tmp/script.sh');
      expect(cmd).not.toContain('&&');
      expect(cmd).not.toContain('rm -f');
    });

    it('double-quotes the --command value', () => {
      const cmd = buildSshExecScriptCommand(PROJECT, ZONE, '/tmp/script.sh');
      expect(cmd).toMatch(/--command="bash \/tmp\/script\.sh"/);
    });

    it('includes required gcloud SSH flags', () => {
      const cmd = buildSshExecScriptCommand(PROJECT, ZONE, '/tmp/script.sh');
      expect(cmd).toContain('gcloud compute ssh lox-vm');
      expect(cmd).toContain('--tunnel-through-iap');
      expect(cmd).toContain('--quiet');
    });
  });

  describe('regression guards', () => {
    it('would have caught #38: unquoted space in --command=echo ok', () => {
      // Simulating the old bug: --command=echo ok (space, no quotes)
      const badCmd = 'gcloud compute ssh vm --command=echo ok';
      expect(() => assertCmdExeSafe(badCmd)).toThrow();
    });

    it('would have caught #40: && inside --command', () => {
      // Simulating the old bug: --command="bash file.sh && rm -f file.sh"
      const badCmd = 'gcloud compute ssh vm --command="bash /tmp/file.sh && rm -f /tmp/file.sh"';
      expect(() => assertCmdExeSafe(badCmd)).toThrow('cmd.exe operator');
    });

    it('would have caught pipe inside --command', () => {
      const badCmd = 'gcloud compute ssh vm --command="cat /etc/passwd | grep root"';
      expect(() => assertCmdExeSafe(badCmd)).toThrow('cmd.exe operator');
    });
  });

  describe('assertCmdExeSafe edge cases', () => {
    it('accepts commands with no --command flag', () => {
      const cmd = 'gcloud compute ssh vm --zone=us-east1-b --project=test';
      assertCmdExeSafe(cmd);
    });

    it('accepts --command=true (no quotes needed for single word)', () => {
      const cmd = 'gcloud compute ssh vm --command=true';
      assertCmdExeSafe(cmd);
    });

    it('rejects caret escape character (cmd.exe special)', () => {
      const cmd = buildSshExecCommand(PROJECT, ZONE, 'echo ^hello');
      expect(() => assertCmdExeSafe(cmd)).toThrow('cmd.exe operator');
    });

    it('accepts --command="" (empty quoted value)', () => {
      const cmd = 'gcloud compute ssh vm --command=""';
      assertCmdExeSafe(cmd);
    });

    it('rejects backslash-quote that could escape the quoted boundary', () => {
      // On cmd.exe, backslash-quote handling may allow operators to leak
      const badCmd = 'gcloud compute ssh vm --command="echo \\"hello && rm -rf /"';
      expect(() => assertCmdExeSafe(badCmd)).toThrow();
    });
  });
});
