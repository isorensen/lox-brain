import { shell, getPlatform } from '../utils/shell.js';

export interface PrerequisiteResult {
  name: string;
  installed: boolean;
  version?: string;
  installCommand?: string;
}

async function checkNode(): Promise<PrerequisiteResult> {
  try {
    const { stdout } = await shell('node', ['--version']);
    const version = stdout.replace('v', '');
    const major = parseInt(version.split('.')[0], 10);
    return {
      name: 'Node.js',
      installed: major >= 22,
      version: stdout,
      installCommand: major < 22 ? getNodeInstallCommand() : undefined,
    };
  } catch {
    return { name: 'Node.js', installed: false, installCommand: getNodeInstallCommand() };
  }
}

function getNodeInstallCommand(): string {
  const platform = getPlatform();
  switch (platform) {
    case 'windows': return 'winget install OpenJS.NodeJS.LTS';
    case 'macos': return 'brew install node@22';
    default: return 'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs';
  }
}

async function checkGit(): Promise<PrerequisiteResult> {
  try {
    const { stdout } = await shell('git', ['--version']);
    return { name: 'git', installed: true, version: stdout };
  } catch {
    const platform = getPlatform();
    const cmd = platform === 'windows' ? 'winget install Git.Git' :
                platform === 'macos' ? 'brew install git' : 'sudo apt install -y git';
    return { name: 'git', installed: false, installCommand: cmd };
  }
}

export async function checkGcloud(): Promise<PrerequisiteResult> {
  try {
    const { stdout } = await shell('gcloud', ['--version']);
    const firstLine = stdout.split('\n')[0] ?? '';
    return { name: 'gcloud CLI', installed: true, version: firstLine };
  } catch {
    // On Windows, gcloud SDK installs gcloud.cmd (batch wrapper).
    // Node.js execFile() doesn't resolve .cmd extensions, so try explicitly.
    if (getPlatform() === 'windows') {
      try {
        const { stdout } = await shell('gcloud.cmd', ['--version']);
        const firstLine = stdout.split('\n')[0] ?? '';
        return { name: 'gcloud CLI', installed: true, version: firstLine };
      } catch {
        // Both gcloud and gcloud.cmd failed — fall through to not-installed
      }
    }

    return {
      name: 'gcloud CLI',
      installed: false,
      installCommand: 'https://cloud.google.com/sdk/docs/install',
    };
  }
}

async function checkGh(): Promise<PrerequisiteResult> {
  try {
    const { stdout } = await shell('gh', ['--version']);
    const firstLine = stdout.split('\n')[0] ?? '';
    return { name: 'GitHub CLI (gh)', installed: true, version: firstLine };
  } catch {
    const platform = getPlatform();
    const cmd = platform === 'windows' ? 'winget install GitHub.cli' :
                platform === 'macos' ? 'brew install gh' : 'sudo apt install -y gh';
    return { name: 'GitHub CLI (gh)', installed: false, installCommand: cmd };
  }
}

async function checkWireGuard(): Promise<PrerequisiteResult> {
  try {
    const { stdout } = await shell('wg', ['--version']);
    return { name: 'WireGuard', installed: true, version: stdout };
  } catch {
    const platform = getPlatform();
    const cmd = platform === 'windows' ? 'winget install WireGuard.WireGuard' :
                platform === 'macos' ? 'brew install wireguard-tools' : 'sudo apt install -y wireguard';
    return { name: 'WireGuard', installed: false, installCommand: cmd };
  }
}

export async function checkAllPrerequisites(): Promise<PrerequisiteResult[]> {
  return Promise.all([
    checkNode(),
    checkGit(),
    checkGcloud(),
    checkGh(),
    checkWireGuard(),
  ]);
}
