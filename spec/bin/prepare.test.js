import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

const { spawn, exec, watchContent, children } = vi.hoisted(() => ({
  spawn: vi.fn(),
  exec: vi.fn(),
  watchContent: vi.fn(),
  children: [],
}));

vi.mock('child_process', () => ({
  default: { spawn, exec },
  spawn,
  exec,
}));

vi.mock('#src/lib/contentUtils/contentUtils.js', () => ({
  default: {
    watchContent,
    prepareContent: vi.fn(),
    prepareAssets: vi.fn(),
    createContent: vi.fn(),
    createComponent: vi.fn(),
  },
}));

vi.mock('#src/lib/loader.js', () => ({
  default: {
    loadModules: vi.fn(() => ({})),
    importData: vi.fn(),
  },
}));

const originalArgv = process.argv;

const startWatch = async (...flags) => {
  process.argv = ['node', 'bin/prepare', 'watch', ...flags];
  vi.resetModules();
  await import('../../bin/prepare');
  expect(watchContent).toHaveBeenCalledTimes(1);
  return watchContent.mock.calls[0][0];
};

describe('bin/prepare watch', () => {
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    children.length = 0;
    spawn.mockReset();
    exec.mockReset();
    watchContent.mockReset();
    spawn.mockImplementation(() => {
      const child = new EventEmitter();
      children.push(child);
      return child;
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv;
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('should register a rebuild callback with watchContent', async () => {
    const rebuild = await startWatch('--fast-highlight');
    expect(typeof rebuild).toBe('function');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('should spawn a dev build with fast highlighting on change', async () => {
    const rebuild = await startWatch('--fast-highlight');
    rebuild();
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      'bin/prepare',
      ['dev', '--fast-highlight'],
      { stdio: 'inherit' }
    );
    expect(exec).not.toHaveBeenCalled();
  });

  it('should spawn a dev build without fast highlighting when the flag is missing', async () => {
    const rebuild = await startWatch();
    expect(logSpy).toHaveBeenCalledWith(
      'Watch mode started with fast highlighting disabled.'
    );
    rebuild();
    expect(spawn).toHaveBeenCalledWith('bin/prepare', ['dev'], {
      stdio: 'inherit',
    });
  });

  it('should not spawn a second build while one is running', async () => {
    const rebuild = await startWatch('--fast-highlight');
    rebuild();
    rebuild();
    rebuild();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('should coalesce changes during a build into a single pending rebuild', async () => {
    const rebuild = await startWatch('--fast-highlight');
    rebuild();
    rebuild();
    rebuild();
    children[0].emit('exit', 0, null);
    expect(spawn).toHaveBeenCalledTimes(2);
    children[1].emit('exit', 0, null);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('should not rebuild after exit when no changes are pending', async () => {
    const rebuild = await startWatch('--fast-highlight');
    rebuild();
    children[0].emit('exit', 0, null);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('should allow a new build after the previous one finishes', async () => {
    const rebuild = await startWatch('--fast-highlight');
    rebuild();
    children[0].emit('exit', 0, null);
    rebuild();
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('should not log an error on a successful exit', async () => {
    const rebuild = await startWatch('--fast-highlight');
    rebuild();
    children[0].emit('exit', 0, null);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('should log the exit code on a failed build', async () => {
    const rebuild = await startWatch('--fast-highlight');
    rebuild();
    children[0].emit('exit', 1, null);
    expect(errorSpy).toHaveBeenCalledWith(
      'Content preparation exited with code 1.'
    );
  });

  it('should log the signal when the build is killed', async () => {
    const rebuild = await startWatch('--fast-highlight');
    rebuild();
    children[0].emit('exit', null, 'SIGTERM');
    expect(errorSpy).toHaveBeenCalledWith(
      'Content preparation exited with signal SIGTERM.'
    );
  });

  it('should still run a pending rebuild after a failed build', async () => {
    const rebuild = await startWatch('--fast-highlight');
    rebuild();
    rebuild();
    children[0].emit('exit', 2, null);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('should log and recover when the build fails to start', async () => {
    const rebuild = await startWatch('--fast-highlight');
    rebuild();
    children[0].emit('error', new Error('spawn ENOENT'));
    expect(errorSpy).toHaveBeenCalledWith(
      'Content preparation failed to start: spawn ENOENT'
    );
    rebuild();
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('should only finish once when both error and exit are emitted', async () => {
    const rebuild = await startWatch('--fast-highlight');
    rebuild();
    rebuild();
    children[0].emit('error', new Error('boom'));
    expect(spawn).toHaveBeenCalledTimes(2);
    rebuild();
    children[0].emit('exit', 1, null);
    expect(spawn).toHaveBeenCalledTimes(2);
    children[1].emit('exit', 0, null);
    expect(spawn).toHaveBeenCalledTimes(3);
  });
});
