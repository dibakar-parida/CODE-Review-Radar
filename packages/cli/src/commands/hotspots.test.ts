import { describe, it, expect } from 'vitest';
import { createHotspotsCommand } from './hotspots.js';

describe('CLI cr hotspots command', () => {
  it('instantiates hotspots commander subcommand', () => {
    const cmd = createHotspotsCommand();
    expect(cmd.name()).toBe('hotspots');
    expect(cmd.description()).toContain('Analyze git commit history');
    expect(cmd.options.some((o) => o.flags.includes('--max'))).toBe(true);
  });
});
