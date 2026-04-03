import chalk from 'chalk';

const TOP_LEFT = '\u256D';
const TOP_RIGHT = '\u256E';
const BOTTOM_LEFT = '\u2570';
const BOTTOM_RIGHT = '\u256F';
const HORIZONTAL = '\u2500';
const VERTICAL = '\u2502';

/**
 * Render a Unicode rounded-corner box around the given lines.
 */
export function renderBox(lines: string[], padding = 1): string {
  if (lines.length === 0) return '';
  const maxLen = Math.max(...lines.map(l => l.length));
  const innerWidth = maxLen + padding * 2;

  const pad = ' '.repeat(padding);
  const top = `${TOP_LEFT}${HORIZONTAL.repeat(innerWidth)}${TOP_RIGHT}`;
  const bottom = `${BOTTOM_LEFT}${HORIZONTAL.repeat(innerWidth)}${BOTTOM_RIGHT}`;

  const contentLines = lines.map(line => {
    const rightPad = ' '.repeat(maxLen - line.length);
    return `${VERTICAL}${pad}${line}${rightPad}${pad}${VERTICAL}`;
  });

  return [top, ...contentLines, bottom].join('\n');
}

/**
 * Render a step header with step number, total, and title.
 */
export function renderStepHeader(step: number, total: number, title: string): string {
  const prefix = chalk.cyan.bold(`[${step}/${total}]`);
  const titleText = chalk.white.bold(title);
  const separator = chalk.dim(HORIZONTAL.repeat(40));
  return `\n${separator}\n  ${prefix} ${titleText}\n${separator}`;
}
