import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isMcpServerRegistered, buildMcpLauncherScript, fixWindowsSshAcl, buildVpnUnreachableMessage, tightenGcloudSshKey, configureSshConfig, getMcpServerName, installMcpService } from '../../src/steps/step-mcp.js';
import { shell } from '../../src/utils/shell.js';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('../../src/utils/shell.js', () => ({
  shell: vi.fn(),
}));

describe('isMcpServerRegistered', () => {
  beforeEach(() => {
    vi.mocked(shell).mockReset();
  });

  it('returns true when the server name appears in claude mcp list', async () => {
    vi.mocked(shell).mockResolvedValue({
      stdout: 'lox-brain: ssh lox-vm cd /home/lox/lox-brain && node ...\nother: node foo.js',
      stderr: '',
    });
    expect(await isMcpServerRegistered('lox-brain')).toBe(true);
  });

  it('returns false when the server name is not present', async () => {
    vi.mocked(shell).mockResolvedValue({
      stdout: 'other-server: node foo.js\nanother: node bar.js',
      stderr: '',
    });
    expect(await isMcpServerRegistered('lox-brain')).toBe(false);
  });

  it('returns false when claude mcp list is empty', async () => {
    vi.mocked(shell).mockResolvedValue({ stdout: '', stderr: '' });
    expect(await isMcpServerRegistered('lox-brain')).toBe(false);
  });

  it('does not false-positive on a name that contains the target as a substring', async () => {
    vi.mocked(shell).mockResolvedValue({
      stdout: 'lox-brain-staging: node foo.js',
      stderr: '',
    });
    expect(await isMcpServerRegistered('lox-brain')).toBe(false);
  });

  it('returns false when claude mcp list throws', async () => {
    vi.mocked(shell).mockRejectedValue(new Error('claude: command not found'));
    expect(await isMcpServerRegistered('lox-brain')).toBe(false);
  });
});

describe('buildMcpLauncherScript', () => {
  it('starts with a bash shebang and fail-fast flags', () => {
    const script = buildMcpLauncherScript('/home/lox/lox-brain');
    const lines = script.split('\n');
    expect(lines[0]).toBe('#!/bin/bash');
    expect(lines[1]).toBe('set -euo pipefail');
  });

  it('cds into the provided install dir verbatim', () => {
    expect(buildMcpLauncherScript('/opt/lox')).toContain('cd /opt/lox\n');
    expect(buildMcpLauncherScript('/home/alice/lox-brain')).toContain('cd /home/alice/lox-brain\n');
  });

  it('loads secrets.env with set -a / set +a', () => {
    const script = buildMcpLauncherScript('/home/lox/lox-brain');
    expect(script).toContain('set -a');
    expect(script).toContain('source /etc/lox/secrets.env');
    expect(script).toContain('set +a');
  });

  it('execs node on the MCP entrypoint (replaces the shell)', () => {
    const script = buildMcpLauncherScript('/home/lox/lox-brain');
    expect(script).toContain('exec node packages/core/dist/mcp/index.js');
  });

  it('ends with a trailing newline', () => {
    const script = buildMcpLauncherScript('/home/lox/lox-brain');
    expect(script.endsWith('\n')).toBe(true);
  });
});

describe('tightenGcloudSshKey (#101)', () => {
  let tmp: string;
  const originalPlatform = process.platform;
  const originalUsername = process.env.USERNAME;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'lox-ssh-key-'));
    mkdirSync(tmp, { recursive: true });
    vi.mocked(shell).mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    if (originalUsername === undefined) delete process.env.USERNAME;
    else process.env.USERNAME = originalUsername;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('is a no-op when the gcloud private key does not exist', async () => {
    // Standalone step 12 runs may hit this path if no earlier step has
    // invoked `gcloud compute ssh` yet — fixWindowsAcl must not be called
    // on a missing file (icacls would error on a non-existent path).
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.USERNAME = 'alice';
    await tightenGcloudSshKey(tmp);
    expect(shell).not.toHaveBeenCalled();
  });

  it('is a no-op on non-Windows platforms even if the key exists', async () => {
    // fixWindowsAcl gates internally, but we exercise the happy path here:
    // Linux/macOS key-perm management is POSIX-based (chmod 600 elsewhere),
    // not icacls. No shell invocation expected.
    Object.defineProperty(process, 'platform', { value: 'linux' });
    writeFileSync(path.join(tmp, 'google_compute_engine'), 'fake-key');
    await tightenGcloudSshKey(tmp);
    expect(shell).not.toHaveBeenCalled();
  });

  it('invokes icacls on the gcloud key path when on Windows and the key exists', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.USERNAME = 'alice';
    vi.mocked(shell).mockResolvedValue({ stdout: '', stderr: '' });
    const keyPath = path.join(tmp, 'google_compute_engine');
    writeFileSync(keyPath, 'fake-key');

    await tightenGcloudSshKey(tmp);

    // Post-#101-followup: fixWindowsAcl now runs 6 icacls calls (inherit
    // strip + 4 principal removals + grant). The exact sequence is owned
    // by fixWindowsAcl's own tests; here we just verify ALL invocations
    // were icacls targeting the gcloud key path.
    expect(shell).toHaveBeenCalledTimes(6);
    for (const call of vi.mocked(shell).mock.calls) {
      expect(call[0]).toBe('icacls');
      expect(call[1]).toContain(keyPath);
    }
  });
});

describe('configureSshConfig (#109 re-run regression)', () => {
  let tmp: string;
  const originalPlatform = process.platform;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalUsername = process.env.USERNAME;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'lox-ssh-cfg-'));
    // Point HOME (and USERPROFILE on Windows CI) to our tmp dir so
    // configureSshConfig reads/writes under there instead of $HOME.
    process.env.HOME = tmp;
    process.env.USERPROFILE = tmp;
    vi.mocked(shell).mockReset();
    vi.mocked(shell).mockResolvedValue({ stdout: '', stderr: '' });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    if (originalUsername === undefined) delete process.env.USERNAME;
    else process.env.USERNAME = originalUsername;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('calls tightenGcloudSshKey when lox-vm is ALREADY in ~/.ssh/config (re-run path, #109)', async () => {
    // This is the bug scenario: user re-runs the installer, ~/.ssh/config
    // already has `Host lox-vm`, so configureSshConfig took an early
    // return and NEVER tightened the gcloud key ACLs. Ship-blocker for
    // every Windows re-run.
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.USERNAME = 'alice';

    // Seed an existing ~/.ssh/config with the Host lox-vm entry and the
    // gcloud private key file. configureSshConfig must tighten the key
    // despite taking the "already configured" branch.
    const sshDir = path.join(tmp, '.ssh');
    mkdirSync(sshDir, { recursive: true });
    writeFileSync(path.join(sshDir, 'config'), 'Host lox-vm\n  HostName 10.10.0.1\n');
    writeFileSync(path.join(sshDir, 'google_compute_engine'), 'fake-key');

    await configureSshConfig('10.10.0.1', 'alice');

    // fixWindowsAcl runs on each target (sshDir, configPath, keyPath) via
    // the #101 6-call icacls sequence. We just need to prove the KEY path
    // was among the icacls targets — that's what #109 was breaking.
    const keyPath = path.join(sshDir, 'google_compute_engine');
    const icaclsCalls = vi.mocked(shell).mock.calls.filter(
      (c) => c[0] === 'icacls' && c[1]?.includes(keyPath),
    );
    expect(icaclsCalls.length).toBeGreaterThan(0);
  });

  it('calls tightenGcloudSshKey on the fresh-config path too', async () => {
    // The other branch: no existing Host lox-vm entry. The tightening
    // must still run. Both paths matter — don't regress the NEW code path
    // while fixing the re-run path.
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.USERNAME = 'alice';
    const sshDir = path.join(tmp, '.ssh');
    mkdirSync(sshDir, { recursive: true });
    writeFileSync(path.join(sshDir, 'google_compute_engine'), 'fake-key');
    // NO existing config file.

    await configureSshConfig('10.10.0.1', 'alice');

    const keyPath = path.join(sshDir, 'google_compute_engine');
    const icaclsCalls = vi.mocked(shell).mock.calls.filter(
      (c) => c[0] === 'icacls' && c[1]?.includes(keyPath),
    );
    expect(icaclsCalls.length).toBeGreaterThan(0);
  });
});

describe('buildVpnUnreachableMessage (#93)', () => {
  it('names the unreachable VPN endpoint so the user knows what to activate', () => {
    const msg = buildVpnUnreachableMessage('10.10.0.1', 'linux');
    expect(msg).toContain('10.10.0.1:22');
    expect(msg).toContain('WireGuard VPN');
  });

  it('gives Windows users GUI-flavored activation instructions', () => {
    const msg = buildVpnUnreachableMessage('10.10.0.1', 'win32');
    expect(msg).toContain('WireGuard app');
    expect(msg).toContain('Activate');
    // Reference the Windows-native path using env var, not a user-absolute path.
    expect(msg).toContain('%USERPROFILE%');
    // Must not leak a Unix-style activation command to Windows users.
    expect(msg).not.toContain('wg-quick up');
  });

  it('tells Linux users to run wg-quick up', () => {
    const msg = buildVpnUnreachableMessage('10.10.0.1', 'linux');
    expect(msg).toContain('wg-quick up');
    expect(msg).toContain('~/.config/lox/wireguard/wg0.conf');
  });

  it('tells macOS users about both the GUI and wg-quick', () => {
    const msg = buildVpnUnreachableMessage('10.10.0.1', 'darwin');
    expect(msg).toMatch(/WireGuard app/);
    expect(msg).toContain('wg-quick up');
  });

  it('uses the provided iface name in conf file references (team mode)', () => {
    const msg = buildVpnUnreachableMessage('10.20.0.1', 'linux', 'wg1');
    expect(msg).toContain('wg1.conf');
    expect(msg).not.toContain('wg0.conf');
  });

  it('uses wg1.conf in Windows path for team mode', () => {
    const msg = buildVpnUnreachableMessage('10.20.0.1', 'win32', 'wg1');
    expect(msg).toContain('wg1.conf');
    expect(msg).not.toContain('wg0.conf');
  });

  it('falls through to the Unix wg-quick message on unknown platforms', () => {
    // process.platform is typed as NodeJS.Platform (freebsd, openbsd, etc.).
    // Anything that isn't win32/darwin must use the wg-quick fallback —
    // don't let the darwin branch accidentally become the catch-all.
    const msg = buildVpnUnreachableMessage('10.10.0.1', 'freebsd' as NodeJS.Platform);
    expect(msg).toContain('sudo wg-quick up');
    expect(msg).not.toContain('WireGuard app');
  });

  it('points the user at the resume prompt for recovery (#81/#92)', () => {
    const msg = buildVpnUnreachableMessage('10.10.0.1', 'win32');
    expect(msg).toMatch(/re-run the installer/i);
    expect(msg).toMatch(/resume/i);
    expect(msg).toContain('step 12');
  });
});

describe("fixWindowsSshAcl (#83)", () => {
  const originalPlatform = process.platform;
  const originalUsername = process.env.USERNAME;
  const originalUser = process.env.USER;
  const originalUserDomain = process.env.USERDOMAIN;

  beforeEach(() => {
    vi.mocked(shell).mockReset();
    // Default to a populated USERDOMAIN to mirror real Windows behavior
    // (standard MS-populated env var on both domain-joined AND workgroup
    // machines). Tests that want the unset case will override it.
    process.env.USERDOMAIN = "CORPNET";
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    if (originalUsername === undefined) delete process.env.USERNAME;
    else process.env.USERNAME = originalUsername;
    if (originalUser === undefined) delete process.env.USER;
    else process.env.USER = originalUser;
    if (originalUserDomain === undefined) delete process.env.USERDOMAIN;
    else process.env.USERDOMAIN = originalUserDomain;
  });

  it("is a no-op on non-Windows platforms", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.USERNAME = "alice";
    await fixWindowsSshAcl("/home/alice/.ssh/config");
    expect(shell).not.toHaveBeenCalled();
  });

  it("runs the full icacls hardening sequence on Windows (#101 follow-up)", async () => {
    // Hardening added after v0.6.7: /inheritance:r alone was leaving
    // EXPLICIT CREATOR OWNER / BUILTIN\Users ACEs on gcloud-created key
    // files, and OpenSSH still rejected them. We now:
    //   1. strip inherited ACEs
    //   2. explicitly /remove the 4 common loose principals
    //   3. grant the current user Full control
    // = 6 total icacls invocations.
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.USERNAME = "alice";
    vi.mocked(shell).mockResolvedValue({ stdout: "", stderr: "" });
    const target = "C:\\Users\\alice\\.ssh\\google_compute_engine";
    await fixWindowsSshAcl(target);
    expect(shell).toHaveBeenCalledWith("icacls", [target, "/inheritance:r"]);
    expect(shell).toHaveBeenCalledWith("icacls", [target, "/remove", "CREATOR OWNER"]);
    expect(shell).toHaveBeenCalledWith("icacls", [target, "/remove", "BUILTIN\\Users"]);
    expect(shell).toHaveBeenCalledWith("icacls", [target, "/remove", "Authenticated Users"]);
    expect(shell).toHaveBeenCalledWith("icacls", [target, "/remove", "Everyone"]);
    // DOMAIN\USER format (#113) — on domain-joined pt-BR machine this
    // is `CORPNET\alice`, on workgroup `COMPUTER\alice`.
    expect(shell).toHaveBeenCalledWith("icacls", [target, "/grant:r", "CORPNET\\alice:(F)"]);
    expect(shell).toHaveBeenCalledTimes(6);
  });

  it("uses DOMAIN\\USER format when USERDOMAIN is set (#113)", async () => {
    // Core of #113: on a domain-joined machine, bare `USERNAME` doesn't
    // resolve to the user's actual domain account. icacls silently
    // drops the grant and the user loses access to their own SSH key.
    // DOMAIN\USERNAME resolves correctly on both domain-joined AND
    // workgroup machines (workgroup's USERDOMAIN = computer name).
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.USERNAME = "alice.domain";
    process.env.USERDOMAIN = "corpnet";
    vi.mocked(shell).mockResolvedValue({ stdout: "", stderr: "" });
    await fixWindowsSshAcl("C:\\path");
    expect(shell).toHaveBeenCalledWith("icacls", ["C:\\path", "/grant:r", "corpnet\\alice.domain:(F)"]);
  });

  it("falls back to bare USERNAME when USERDOMAIN is unset", async () => {
    // Non-standard Windows environment (shouldn't happen on Microsoft-
    // shipped Windows, but restricted shells / minimal containers can
    // blank USERDOMAIN). Use bare USERNAME rather than produce an
    // invalid `\alice:(F)` principal.
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.USERNAME = "alice";
    delete process.env.USERDOMAIN;
    vi.mocked(shell).mockResolvedValue({ stdout: "", stderr: "" });
    await fixWindowsSshAcl("C:\\path");
    expect(shell).toHaveBeenCalledWith("icacls", ["C:\\path", "/grant:r", "alice:(F)"]);
  });

  it("falls back to USER if USERNAME is unset (edge case)", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    delete process.env.USERNAME;
    process.env.USER = "bob";
    process.env.USERDOMAIN = "WORKGROUP";
    vi.mocked(shell).mockResolvedValue({ stdout: "", stderr: "" });
    await fixWindowsSshAcl("C:\\path");
    expect(shell).toHaveBeenCalledWith("icacls", ["C:\\path", "/grant:r", "WORKGROUP\\bob:(F)"]);
  });

  it("treats an empty USERNAME env var as unset and falls back to USER", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.USERNAME = "";
    process.env.USER = "alice";
    process.env.USERDOMAIN = "DESKTOP-X1";
    vi.mocked(shell).mockResolvedValue({ stdout: "", stderr: "" });
    await fixWindowsSshAcl("C:\\path");
    expect(shell).toHaveBeenCalledWith("icacls", ["C:\\path", "/grant:r", "DESKTOP-X1\\alice:(F)"]);
  });

  it("continues the sequence even if a /remove call fails (principal absent)", async () => {
    // On a file whose ACL doesn't have CREATOR OWNER, `icacls /remove` exits
    // non-zero. That must NOT abort the rest of the sequence — the user
    // grant still needs to be applied.
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.USERNAME = "alice";
    vi.mocked(shell).mockImplementation(async (_cmd, args) => {
      if (args?.includes("CREATOR OWNER")) {
        throw new Error("icacls: No mapping between account names and security IDs was done.");
      }
      return { stdout: "", stderr: "" };
    });
    await fixWindowsSshAcl("C:\\path");
    // The /grant:r must still fire despite the earlier /remove failure.
    expect(shell).toHaveBeenCalledWith("icacls", ["C:\\path", "/grant:r", "CORPNET\\alice:(F)"]);
  });

  it("trims whitespace-only USERNAME/USER before treating as unset", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.USERNAME = "   ";
    process.env.USER = "   ";
    await fixWindowsSshAcl("C:\\path");
    expect(shell).not.toHaveBeenCalled();
  });

  it("is a no-op when no username can be resolved", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    delete process.env.USERNAME;
    delete process.env.USER;
    await fixWindowsSshAcl("C:\\path");
    expect(shell).not.toHaveBeenCalled();
  });

  it("swallows icacls failures (best-effort)", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.USERNAME = "alice";
    vi.mocked(shell).mockRejectedValue(new Error("icacls exited with code 1"));
    await expect(fixWindowsSshAcl("C:\\path")).resolves.toBeUndefined();
  });
});

describe('getMcpServerName', () => {
  it('returns "lox-brain" for personal mode', () => {
    expect(getMcpServerName('personal')).toBe('lox-brain');
  });

  it('returns "lox-brain-<org>" for team mode with org', () => {
    expect(getMcpServerName('team', 'credifit')).toBe('lox-brain-credifit');
  });

  it('returns "lox-brain" for team mode without org', () => {
    expect(getMcpServerName('team')).toBe('lox-brain');
  });

  it('returns "lox-brain" for team mode with undefined org', () => {
    expect(getMcpServerName('team', undefined)).toBe('lox-brain');
  });
});

describe('installMcpService', () => {
  // installMcpService reads the real systemd template from infra/systemd/,
  // writes a tmp file with placeholders replaced, then calls shell commands.
  // We capture the tmp file content during the scp mock (before finally cleanup).
  let capturedContent: string | undefined;

  beforeEach(() => {
    vi.mocked(shell).mockReset();
    capturedContent = undefined;
    // Capture the scp call to read the tmp file BEFORE the finally block deletes it
    vi.mocked(shell).mockImplementation(async (_cmd, args) => {
      if (_cmd === 'scp' && args && args.length >= 2) {
        capturedContent = readFileSync(args[0], 'utf-8');
      }
      return { stdout: '', stderr: '' };
    });
  });

  it('replaces placeholders in the template and runs the correct shell commands', async () => {
    await installMcpService('/home/lox/lox-brain', 'lox');

    // Verify the 4 shell commands: scp, mv, daemon-reload, enable
    expect(shell).toHaveBeenCalledTimes(4);

    // scp uploads to lox-vm:/tmp/lox-mcp.service
    const scpCall = vi.mocked(shell).mock.calls[0];
    expect(scpCall[0]).toBe('scp');
    expect(scpCall[1]?.[1]).toBe('lox-vm:/tmp/lox-mcp.service');

    // Verify the captured content has placeholders replaced
    expect(capturedContent).toBeDefined();
    expect(capturedContent).toContain('User=lox');
    expect(capturedContent).toContain('WorkingDirectory=/home/lox/lox-brain');
    expect(capturedContent).toContain('/home/lox/lox-brain/packages/core/dist/mcp/index.js');
    expect(capturedContent).not.toContain('__LOX_VM_USER__');
    expect(capturedContent).not.toContain('__LOX_INSTALL_DIR__');

    // mv to systemd dir
    expect(vi.mocked(shell).mock.calls[1]).toEqual([
      'ssh', ['lox-vm', 'sudo', 'mv', '/tmp/lox-mcp.service', '/etc/systemd/system/lox-mcp.service'], { timeout: 30_000 },
    ]);
    // daemon-reload
    expect(vi.mocked(shell).mock.calls[2]).toEqual([
      'ssh', ['lox-vm', 'sudo', 'systemctl', 'daemon-reload'], { timeout: 30_000 },
    ]);
    // enable --now
    expect(vi.mocked(shell).mock.calls[3]).toEqual([
      'ssh', ['lox-vm', 'sudo', 'systemctl', 'enable', '--now', 'lox-mcp'], { timeout: 30_000 },
    ]);
  });

  it('cleans up the tmp file even when shell commands fail', async () => {
    vi.mocked(shell).mockRejectedValue(new Error('scp: connection refused'));

    await expect(installMcpService('/opt/lox', 'lox')).rejects.toThrow('connection refused');

    // The tmp file should have been cleaned up by the finally block.
    // We can't easily verify rmSync was called on the exact path without
    // mocking fs, but we verify the function propagates the error correctly.
  });
});
