// Structured error code taxonomy for public API consumers
export const ErrorCode = {
  // Auth
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',

  // Validation
  INVALID_ACTION: 'INVALID_ACTION',
  INVALID_BODY: 'INVALID_BODY',
  INVALID_PARAMS: 'INVALID_PARAMS',

  // Game protocol
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  TURN_ALREADY_PROCESSED: 'TURN_ALREADY_PROCESSED',
  ARENA_NOT_FOUND: 'ARENA_NOT_FOUND',
  AGENT_NOT_IN_ARENA: 'AGENT_NOT_IN_ARENA',

  // SDK/agent
  AGENT_NOT_FOUND: 'AGENT_NOT_FOUND',
  SESSION_INVALID: 'SESSION_INVALID',

  // Server
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode];

export interface ApiErrorResponse {
  error: string;        // human-readable message
  code: ErrorCode;      // machine-readable code
  retryable: boolean;   // whether the client should retry
  details?: unknown;    // optional structured details (validation errors etc.)
}

export function apiError(
  code: ErrorCode,
  message: string,
  retryable = false,
  details?: unknown,
): ApiErrorResponse {
  return { error: message, code, retryable, details };
}
