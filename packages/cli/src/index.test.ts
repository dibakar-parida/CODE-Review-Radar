import { describe, it, expect } from 'vitest';
import { createProgram } from './index.js';

describe('@cr/cli command registration', () => {
  it('registers all Phase commands: review, index, fix, serve', () => {
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());

    expect(commandNames).toContain('review');
    expect(commandNames).toContain('index');
    expect(commandNames).toContain('fix');
    expect(commandNames).toContain('serve');
  });

  it('configures review command flags accurately', () => {
    const program = createProgram();
    const reviewCmd = program.commands.find((c) => c.name() === 'review');
    expect(reviewCmd).toBeDefined();

    const options = reviewCmd!.options.map((o) => o.attributeName());
    expect(options).toContain('target');
    expect(options).toContain('ref');
    expect(options).toContain('base');
    expect(options).toContain('format');
    expect(options).toContain('config');
    expect(options).toContain('output');
  });

  it('configures fix command flags accurately', () => {
    const program = createProgram();
    const fixCmd = program.commands.find((c) => c.name() === 'fix');
    expect(fixCmd).toBeDefined();

    const options = fixCmd!.options.map((o) => o.attributeName());
    expect(options).toContain('target');
    expect(options).toContain('config');
    expect(options).toContain('yes');
    expect(options).toContain('verify');
    expect(options).toContain('withTests');
  });
});
