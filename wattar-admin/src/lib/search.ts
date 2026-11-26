/**
 * Helpers for building PostgREST filter strings from user input.
 *
 * PostgREST `or=` / `and=` expressions use commas, parentheses and quotes as
 * grammar characters. Interpolating raw user input into them allows filter
 * injection (for example a term containing `,role.eq.admin`). Values are
 * therefore wrapped in double quotes and reserved characters are escaped.
 */

/** Escape a value so it can be embedded inside a quoted PostgREST filter value. */
export function escapePostgrestValue(term: string): string {
  return term
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

/**
 * Build a case-insensitive `OR` filter across the given columns.
 * Returns `null` when the trimmed term is empty so callers can skip the filter.
 */
export function buildIlikeOr(columns: string[], term: string): string | null {
  const trimmed = term.trim();
  if (!trimmed) return null;
  const escaped = escapePostgrestValue(trimmed);
  return columns.map((column) => `${column}.ilike."%${escaped}%"`).join(',');
}
