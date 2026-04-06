/**
 * cmd.exe safety utilities.
 *
 * On Windows, `execSync` uses `cmd.exe /c` which interprets shell operators
 * (`&&`, `||`, `|`, `>`, `<`, `^`) as command separators even inside double
 * quotes. These helpers validate that command strings built for gcloud SSH
 * are safe for cross-platform execution.
 *
 * @see https://github.com/isorensen/lox-brain/issues/38
 * @see https://github.com/isorensen/lox-brain/issues/40
 */

/**
 * Regex matching cmd.exe operators that act as command separators.
 * These must NEVER appear unprotected in a command string passed to execSync.
 */
export const CMD_EXE_OPERATORS = /(?:&&|\|\||[|><^])/;

/**
 * Validate that a command string is safe for cmd.exe execution.
 *
 * Rules:
 * 1. `--command` values containing spaces or operators must be double-quoted
 * 2. The value inside `--command="..."` must not contain cmd.exe operators
 * 3. No cmd.exe operators may appear outside of `--command` values
 *
 * @throws {Error} If the command string contains unsafe patterns
 */
export function assertCmdExeSafe(cmd: string): void {
  // Check for unquoted --command value with spaces or operators
  const unquotedMatch = cmd.match(/(?:^|\s)--command=([^\s"]+)/);
  const quotedMatch = cmd.match(/(?:^|\s)--command="([^"]*)"/);

  if (unquotedMatch && !quotedMatch) {
    const value = unquotedMatch[1];
    if (value.includes(' ') || CMD_EXE_OPERATORS.test(value)) {
      throw new Error(
        `--command value must be double-quoted when it contains spaces or operators: --command=${value}`,
      );
    }
    // Check if there are trailing tokens after the unquoted value that
    // are not flags (i.e., look like they should be part of the command).
    // e.g. --command=echo ok  =>  "ok" is a stray argument, not a flag.
    const afterCommand = cmd.slice(cmd.indexOf(`--command=${value}`) + `--command=${value}`.length).trim();
    if (afterCommand) {
      const nextToken = afterCommand.split(/\s+/)[0];
      if (nextToken && !nextToken.startsWith('--')) {
        throw new Error(
          `--command value appears to have unquoted arguments (space-separated): --command=${value} ${nextToken}`,
        );
      }
    }
  }

  if (quotedMatch) {
    const innerValue = quotedMatch[1];
    if (CMD_EXE_OPERATORS.test(innerValue)) {
      throw new Error(
        `--command value contains cmd.exe operator that would be interpreted as command separator: "${innerValue}"`,
      );
    }
  }

  // Check rest of command (outside --command) for operators
  const withoutCommand = cmd.replace(/--command="[^"]*"/g, '').replace(/--command=\S+/g, '');
  if (CMD_EXE_OPERATORS.test(withoutCommand)) {
    throw new Error(
      `Command contains cmd.exe operator outside --command value: ${withoutCommand.match(CMD_EXE_OPERATORS)?.[0]}`,
    );
  }
}
