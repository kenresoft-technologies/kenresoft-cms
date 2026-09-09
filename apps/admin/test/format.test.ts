import { describe, expect, it } from 'vitest';

import { formatBytes } from '@/lib/format';

describe('formatBytes', () => {
  it('formats bytes under 1 KB as bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
  });

  it('formats kilobytes without decimals', () => {
    expect(formatBytes(2048)).toBe('2 KB');
  });

  it('formats megabytes with one decimal, dividing by 1024*1024', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
