import { child, logger } from '../logging/logger.js';

const log = child('exit');

/** Just the part of a pino logger `fatalLines` needs, so any child logger can be passed in. */
export interface FatalLogger {
  fatal(message: string): void;
}

/**
 * Stop cleanly instead of calling `process.exit()` outright.
 *
 * `pino-pretty` runs on a worker thread, and killing the process while that thread is still
 * closing its handles aborts Node with a libuv assertion — an operator would see a crash and
 * exit code 127 where they should see a one-line configuration error. Setting the exit code and
 * letting the event loop drain lets the log transport finish. The watchdog is unref'd, so it can
 * only fire if something really is refusing to let go, which is exactly when a hard exit is right.
 */
export function finishExit(code: number, watchdogMs = 3000): void {
  process.exitCode = code;
  logger.flush?.();
  const watchdog = setTimeout(() => {
    log.warn('something is still holding the process open; exiting anyway');
    process.exit(code);
  }, watchdogMs);
  watchdog.unref();
}

/**
 * Report a thrown error as readable lines. Configuration errors are multi-line and name one key
 * per line, and that is the text a first-run operator has to act on — an escaped blob inside a
 * log field is not good enough.
 */
export function fatalLines(target: FatalLogger, headline: string, message: string): void {
  target.fatal(headline);
  for (const line of message.split('\n')) if (line.trim().length > 0) target.fatal(line);
}
