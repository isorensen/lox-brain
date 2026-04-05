/**
 * Utility to run a long-running async operation with a timeout that the user
 * can choose to extend once. Follows the pattern established in step-vm-setup.ts:
 * on timeout, prompt the user (default=yes) and retry with a larger timeout.
 *
 * The caller passes a function that accepts the current timeout (in ms) and
 * returns a promise; it is responsible for forwarding that timeout to its
 * underlying shell/fetch/etc. call.
 */

/**
 * Returns true when an error is caused by a process timeout (SIGTERM / killed
 * by the child_process timeout option, or shell() wrapping with "timed out").
 */
export function isTimeoutError(err: unknown): boolean {
  if (err instanceof Error) {
    return (
      err.message.includes('timed out') ||
      err.message.includes('SIGTERM') ||
      ('killed' in err && (err as unknown as { killed: boolean }).killed === true)
    );
  }
  if (err !== null && typeof err === 'object' && 'killed' in err) {
    return (err as { killed: boolean }).killed === true;
  }
  return false;
}

export interface ExtendableTimeoutOptions {
  /** Short label used in the confirmation prompt (e.g. "Obsidian install"). */
  label: string;
  /** First attempt timeout, in milliseconds. */
  initialTimeout: number;
  /** Upper bound timeout used on retry, in milliseconds. */
  maxTimeout: number;
  /** Localized prompt shown when the first attempt times out. */
  promptMessage: string;
  /**
   * Optional injected confirmation. Defaults to @inquirer/prompts.confirm
   * with default=true ("keep waiting" unless the user explicitly declines).
   * Exposed for testing.
   */
  confirmFn?: (message: string) => Promise<boolean>;
}

/**
 * Run `fn(timeout)` with the initial timeout. If it throws a timeout error,
 * prompt the user (default=yes) to extend; on confirmation, retry once with
 * maxTimeout. Non-timeout errors and declines propagate immediately.
 */
export async function withExtendableTimeout<T>(
  fn: (timeout: number) => Promise<T>,
  options: ExtendableTimeoutOptions,
): Promise<T> {
  const { label, initialTimeout, maxTimeout, promptMessage } = options;
  let timeout = initialTimeout;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn(timeout);
    } catch (err) {
      if (isTimeoutError(err) && timeout < maxTimeout) {
        const confirmFn = options.confirmFn ?? (async (message: string) => {
          const { confirm } = await import('@inquirer/prompts');
          return confirm({ message, default: true });
        });
        const shouldRetry = await confirmFn(`${label}: ${promptMessage}`);
        if (shouldRetry) {
          timeout = maxTimeout;
          continue;
        }
      }
      throw err;
    }
  }
}
