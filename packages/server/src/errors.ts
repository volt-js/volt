/**
 * What a server function is allowed to tell its caller.
 *
 * The default is nothing. An endpoint is public, so the failure path is read
 * by whoever is probing it, and a stack trace or a driver's message
 * ("relation \"users\" does not exist") is reconnaissance. So an error only
 * reaches the client when it was raised as a `ServerError`, which is a
 * decision the author made about that sentence; everything else becomes a 500
 * with no detail, and the original goes to `onError` where the process's own
 * logging can have it.
 */

export interface ServerErrorOptions {
  /** Kept for the server's own log; never serialized into a response. */
  cause?: unknown;
}

export class ServerError extends Error {
  /**
   * HTTP status. It is the whole API of this class: a client can only act on
   * an error it can classify, and status is the classification every proxy,
   * browser and log aggregator between the two already understands.
   */
  readonly status: number;

  constructor(message: string, status = 500, options?: ServerErrorOptions) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ServerError';
    this.status = status;
  }
}

/** No credentials, or none this endpoint recognises. */
export class Unauthorized extends ServerError {
  constructor(message = 'Unauthorized', options?: ServerErrorOptions) {
    super(message, 401, options);
    this.name = 'Unauthorized';
  }
}

/** Recognised, and not allowed to do this. */
export class Forbidden extends ServerError {
  constructor(message = 'Forbidden', options?: ServerErrorOptions) {
    super(message, 403, options);
    this.name = 'Forbidden';
  }
}

/** The arguments were not what the method's type says they are. */
export class BadRequest extends ServerError {
  constructor(message = 'Bad Request', options?: ServerErrorOptions) {
    super(message, 400, options);
    this.name = 'BadRequest';
  }
}
