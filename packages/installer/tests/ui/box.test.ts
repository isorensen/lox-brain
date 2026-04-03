import { describe, it, expect } from 'vitest';
import { renderBox, renderStepHeader } from '../../src/ui/box.js';

describe('renderBox', () => {
  it('renders a box with borders', () => {
    const result = renderBox(['Hello', 'World']);
    expect(result).toContain('Hello');
    expect(result).toContain('World');
    // Unicode box chars
    expect(result).toContain('\u256D'); // top-left
    expect(result).toContain('\u256E'); // top-right
    expect(result).toContain('\u2570'); // bottom-left
    expect(result).toContain('\u256F'); // bottom-right
  });

  it('pads lines to consistent width', () => {
    const result = renderBox(['Short', 'A longer line here']);
    const lines = result.split('\n');
    // All content lines should have same length
    const contentLines = lines.filter(l => l.includes('\u2502'));
    const lengths = contentLines.map(l => l.length);
    expect(new Set(lengths).size).toBe(1);
  });
});

describe('renderStepHeader', () => {
  it('renders step number and title', () => {
    const result = renderStepHeader(3, 12, 'GCP Project');
    expect(result).toContain('3/12');
    expect(result).toContain('GCP Project');
  });
});
