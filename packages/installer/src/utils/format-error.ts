/**
 * Trim an Error (or any thrown value) into a concise message that is safe
 * to include in auto-reported issue bodies and friendly in the terminal.
 *
 * For Error instances with a stack, returns the first 5 stack lines
 * (message + 4 frames) joined with newlines. For Errors without a stack,
 * returns just the message. For non-Error throws, returns String(err).
 */
export function formatFatalError(err: unknown): string {
  if (err instanceof Error) {
    if (err.stack) {
      return err.stack.split('\n').slice(0, 5).join('\n');
    }
    return err.message;
  }
  return String(err);
}
