/**
 * The one error shape the engine, the CLI, and the HTTP route all speak.
 *
 * `code` is a stable string the panel switches on; `message` is for the user,
 * already localized to Chinese; `details` carries whatever the caller needs to
 * act (conflicted file lists, branch names, paths).
 */
export class EngineError extends Error {
  /**
   * @param code - stable machine-readable code, for example `branch-exists`.
   * @param message - user-facing Chinese sentence.
   * @param details - extra structured context.
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.details = details;
  }
}

/** The envelope a successful command returns. */
export function ok(data) {
  return { ok: true, data };
}

/** The envelope a failed command returns; a non-`EngineError` becomes `internal`. */
export function failure(error) {
  if (error instanceof EngineError) {
    return { ok: false, error: { code: error.code, message: error.message, details: error.details } };
  }
  return {
    ok: false,
    error: {
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
      details: {},
    },
  };
}
