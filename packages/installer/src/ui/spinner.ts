import ora from 'ora';

/**
 * Run an async task with an ora spinner showing progress.
 */
export async function withSpinner<T>(
  text: string,
  task: () => Promise<T>,
  successText?: string,
  failText?: string,
): Promise<T> {
  const spinner = ora({ text, color: 'cyan' }).start();
  try {
    const result = await task();
    spinner.succeed(successText ?? text);
    return result;
  } catch (err) {
    spinner.fail(failText ?? text);
    throw err;
  }
}
