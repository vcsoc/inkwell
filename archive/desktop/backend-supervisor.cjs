'use strict';
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

module.exports = function backendSupervisor({
  command,
  args,
  options,
  probe,
  authenticate,
  onState = () => {},
  log = () => {},
  spawnProcess = spawn,
  startupMs = 60000,
  pollMs = 50,
  retryMs = 250,
  maxAttempts = 5,
  failureWindowMs = 300000,
}) {
  let child = null;
  let stopped = false;
  let connecting = null;
  let recovery = null;
  let attempts = [];

  const state = (value) => {
    log('backend-state', { state: value });
    onState(value);
  };
  async function terminate(process) {
    if (!process?.pid || process.exitCode !== null || process.signalCode !== null) return;
    const exited = new Promise((resolve) => process.once('exit', resolve));
    process.kill('SIGTERM');
    let timer;
    try {
      await Promise.race([
        exited,
        new Promise((resolve) => {
          timer = setTimeout(() => {
            process.kill('SIGKILL');
            resolve();
          }, 2000);
          timer.unref?.();
        }),
      ]);
      if (process.exitCode === null && process.signalCode === null)
        await Promise.race([exited, delay(1000)]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function connect() {
    if (stopped) throw Error('Mail service supervisor is stopped');
    const process = spawnProcess(command, args, options);
    child = process;
    log('backend-spawn', { pid: process.pid });
    let ended = null;
    let ready = false;
    // Drain pipes continuously. Retain exception types, not mail contents or URLs.
    process.stdout?.on('data', () => {});
    let stderr = '';
    process.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-4096);
      const lines = stderr.split('\n');
      stderr = lines.pop();
      for (const line of lines) {
        const type = line.match(/^([\w.]+(?:Error|Exception)):/)?.[1];
        if (type) log('backend-exception', { type });
        const frame = line.match(/^\s*File "([^"]+)", line (\d+), in ([\w<>]+)/);
        if (frame)
          log('backend-trace-frame', {
            file: frame[1].split(/[\\/]/).pop(),
            line: Number(frame[2]),
            function: frame[3],
          });
      }
    });
    process.on('error', (error) => {
      ended = Error('Could not start the mail service: ' + (error.code || error.name));
      log('backend-spawn-error', { code: error.code || error.name });
    });
    process.on('exit', (code, signal) => {
      ended = Error(`Mail service stopped (code ${code}, signal ${signal || 'none'})`);
      log('backend-exit', { code, signal, expected: stopped || child !== process });
      if (child === process) {
        child = null;
        if (ready && !stopped) void recover();
      }
    });
    try {
      const deadline = Date.now() + startupMs;
      while (!stopped && Date.now() < deadline) {
        if (ended) throw ended;
        let reachable = false;
        try {
          reachable = await probe();
        } catch {}
        if (reachable) {
          await authenticate();
          if (stopped || ended || child !== process)
            throw ended || Error('Mail service stopped during connection');
          ready = true;
          state('ready');
          return;
        }
        await delay(pollMs);
      }
      throw Error(stopped ? 'Mail service stopped' : 'Mail service startup timed out');
    } catch (error) {
      if (child === process) child = null;
      await terminate(process);
      throw error;
    }
  }
  function start() {
    if (!connecting)
      connecting = connect().finally(() => {
        connecting = null;
      });
    return connecting;
  }
  function recover() {
    if (recovery || stopped) return recovery;
    state('reconnecting');
    recovery = (async () => {
      while (!stopped) {
        const now = Date.now();
        attempts = attempts.filter((at) => now - at < failureWindowMs);
        if (attempts.length >= maxAttempts) {
          state('failed');
          return;
        }
        attempts.push(now);
        await delay(retryMs * Math.min(8, 2 ** (attempts.length - 1)));
        if (stopped) return;
        try {
          await start();
          // An exit can arrive while this recovery promise is still settling.
          if (child && child.exitCode === null && child.signalCode === null) return;
        } catch (error) {
          log('backend-reconnect-error', { type: error.name });
        }
      }
    })()
      .catch((error) => {
        log('backend-supervisor-error', { type: error.name });
        if (!stopped) state('failed');
      })
      .finally(() => {
        recovery = null;
      });
    return recovery;
  }
  return {
    start,
    retry() {
      if (recovery) return recovery;
      if (child || stopped) return Promise.resolve();
      attempts = [];
      return recover();
    },
    stop() {
      stopped = true;
      const process = child;
      child = null;
      return terminate(process);
    },
  };
};
