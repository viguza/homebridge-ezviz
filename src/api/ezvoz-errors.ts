import { Logging } from 'homebridge';

/**
 * Handle an axios error
 * @param {Logging} log     The log object to output error
 * @param {any} error       The error thrown
 * @param {string} message  The message to add to the log output
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleError(log: Logging | undefined, error: any, message: string): void {
  if (error.response) {
    const status = parseInt(error.response.status);
    const errMsg = `${message}: ${status}`;
    if (status >= 500 || status === 404) {
      log?.debug(errMsg);
    } else {
      log?.error(errMsg);
    }
  } else if (error.code) {
    const errMsg = `${message}: ${error.code}`;
    if (error.code === 'ECONNRESET' || error.code === 'EAI_AGAIN') {
      log?.debug(errMsg);
    } else {
      log?.error(errMsg);
    }
  } else {
    log?.error(error);
  }
}