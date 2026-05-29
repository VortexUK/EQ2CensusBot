/**
 * toErrorMessage — extract a human-readable message from any thrown value.
 *
 * Replaces the `String((err as Error).message ?? err)` pattern used in 15+
 * sites. The `as Error` cast was unsound (err could be a string or any
 * primitive); `instanceof Error` is the correct narrowing.
 */
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return String(err)
}
