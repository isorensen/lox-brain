import { describe, it, expect } from 'vitest';
import {
  buildWatcherService,
  buildCloneScript,
  buildBuildScript,
  buildSecretsEnvScript,
  buildSystemdInstallScript,
  buildServiceStartScript,
  buildMcpHealthProbeScript,
  parseVmIdentity,
  buildIdentityProbeScript,
} from '../../src/steps/step-deploy.js';

describe('buildCloneScript', () => {
  it('clones public upstream when install dir is missing and pulls when present', () => {
    const s = buildCloneScript('/home/lox/lox-brain');
    expect(s.startsWith('#!/bin/bash')).toBe(true);
    expect(s).toContain('set -euo pipefail');
    expect(s).toContain('if [ -d "/home/lox/lox-brain" ]; then');
    expect(s).toContain('cd "/home/lox/lox-brain"');
    expect(s).toContain('git pull');
    expect(s).toContain('git clone https://github.com/isorensen/lox-brain.git "/home/lox/lox-brain"');
  });

  it('quotes the install dir so paths with spaces would not fragment', () => {
    const s = buildCloneScript('/home/alice smith/lox');
    expect(s).toContain('"/home/alice smith/lox"');
  });

  it('does not use gh (anonymous https clone, see #73)', () => {
    expect(buildCloneScript('/home/lox/lox-brain')).not.toContain('gh repo clone');
  });
});

describe('buildBuildScript', () => {
  it('cds into the install dir, installs and builds workspaces', () => {
    const s = buildBuildScript('/home/lox/lox-brain');
    expect(s).toContain('cd "/home/lox/lox-brain"');
    expect(s).toContain('npm ci');
    expect(s).toContain('npm run build --workspaces');
  });
});

describe('buildSecretsEnvScript', () => {
  it('writes secrets.env via sudo tee and chmod 600 + chown to the user', () => {
    const env = 'FOO=1\nBAR=2';
    const s = buildSecretsEnvScript(env, 'lox');
    expect(s).toContain('sudo mkdir -p /etc/lox');
    expect(s).toContain("sudo tee /etc/lox/secrets.env > /dev/null <<'LOX_ENV_EOF'");
    expect(s).toContain('FOO=1');
    expect(s).toContain('BAR=2');
    expect(s).toContain('LOX_ENV_EOF');
    expect(s).toContain('sudo chmod 600 /etc/lox/secrets.env');
    expect(s).toContain('sudo chown lox:lox /etc/lox/secrets.env');
  });

  it('uses a quoted heredoc delimiter so $ and backticks in env values are not expanded', () => {
    const s = buildSecretsEnvScript('PASS=$ecret`bq`', 'lox');
    // Single-quoted heredoc delimiter suppresses variable/command expansion
    expect(s).toContain("<<'LOX_ENV_EOF'");
    expect(s).toContain('PASS=$ecret`bq`');
  });
});

describe('buildSystemdInstallScript', () => {
  it('writes the unit file with sudo tee inside a heredoc', () => {
    const unit = buildWatcherService('lox', '/home/lox/lox-brain');
    const s = buildSystemdInstallScript(unit);
    expect(s).toContain("sudo tee /etc/systemd/system/lox-watcher.service > /dev/null <<'LOX_UNIT_EOF'");
    expect(s).toContain('[Unit]');
    expect(s).toContain('ExecStart=/usr/bin/node packages/core/dist/watcher/index.js');
    expect(s).toContain('LOX_UNIT_EOF');
  });
});

describe('buildServiceStartScript', () => {
  it('reloads systemd then enables and starts lox-watcher', () => {
    const s = buildServiceStartScript();
    expect(s).toContain('sudo systemctl daemon-reload');
    expect(s).toContain('sudo systemctl enable lox-watcher');
    expect(s).toContain('sudo systemctl start lox-watcher');
  });
});

describe('buildMcpHealthProbeScript', () => {
  it('pipes a JSON-RPC request into the MCP server and captures the first line', () => {
    const s = buildMcpHealthProbeScript('/home/lox/lox-brain');
    expect(s).toContain('cd "/home/lox/lox-brain"');
    expect(s).toContain('"jsonrpc":"2.0"');
    expect(s).toContain('"method":"tools/list"');
    expect(s).toContain('timeout 10 node packages/core/dist/mcp/index.js');
    expect(s).toContain('head -1');
  });

  it('does NOT use `set -euo pipefail` (pipefail would suppress probe output on failure)', () => {
    const s = buildMcpHealthProbeScript('/home/lox/lox-brain');
    expect(s).not.toContain('set -euo pipefail');
    expect(s).not.toContain('pipefail');
  });
});

describe('parseVmIdentity', () => {
  it('parses a plain user:/home line', () => {
    expect(parseVmIdentity('lara_gmail_com:/home/lara_gmail_com\n')).toEqual({
      user: 'lara_gmail_com',
      home: '/home/lara_gmail_com',
    });
  });

  it('ignores MOTD banners and warnings before the identity line', () => {
    const stdout = [
      'Warning: Permanently added ... to the list of known hosts.',
      'Welcome to Ubuntu 22.04.3 LTS',
      '',
      'alice:/home/alice',
      '',
    ].join('\n');
    expect(parseVmIdentity(stdout)).toEqual({ user: 'alice', home: '/home/alice' });
  });

  it('accepts usernames with digits, dots, dashes, underscores', () => {
    expect(parseVmIdentity('foo.bar-baz_42:/home/foo.bar-baz_42')).toEqual({
      user: 'foo.bar-baz_42',
      home: '/home/foo.bar-baz_42',
    });
  });

  it('rejects output with no matching line', () => {
    expect(parseVmIdentity('command not found\n')).toBeNull();
    expect(parseVmIdentity('')).toBeNull();
  });

  it('rejects lines where the home path is not absolute', () => {
    expect(parseVmIdentity('alice:relative/path')).toBeNull();
  });

  it('rejects lines where the username contains shell metachars', () => {
    expect(parseVmIdentity('alice;rm -rf /:/home/alice')).toBeNull();
    expect(parseVmIdentity('alice $(whoami):/home/alice')).toBeNull();
  });

  it('rejects lines where the home path contains whitespace', () => {
    expect(parseVmIdentity('alice:/home/alice extra')).toBeNull();
  });

  it('handles newline-injection gracefully (first valid match wins)', () => {
    // A nasty second line cannot override a legitimate first match.
    expect(parseVmIdentity('alice:/home/alice\nroot:/root')).toEqual({
      user: 'alice',
      home: '/home/alice',
    });
  });
});

describe('buildIdentityProbeScript', () => {
  it('is a bash script that echoes $USER:$HOME, runnable via scp+bash (#70)', () => {
    const s = buildIdentityProbeScript();
    expect(s.startsWith('#!/bin/bash')).toBe(true);
    expect(s).toContain('set -euo pipefail');
    expect(s).toContain('echo "${USER}:${HOME}"');
  });
});

describe('buildWatcherService', () => {
  it('fills User, WorkingDirectory from parameters', () => {
    const unit = buildWatcherService('alice', '/opt/lox');
    expect(unit).toContain('User=alice');
    expect(unit).toContain('WorkingDirectory=/opt/lox');
  });
});
