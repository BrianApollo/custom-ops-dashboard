// Whether a SQL text sent to /import/query only reads. Allowed: exactly
// `PRAGMA optimize`, one SELECT, or one WITH whose text holds none of the
// words that write. A `;` anywhere is refused, so only one statement runs.
const WRITES = /\b(INSERT|UPDATE|DELETE|REPLACE)\b/i

export function isReadOnlyQuery(text: unknown): boolean {
  if (typeof text !== 'string') return false
  if (text.includes(';')) return false
  if (text.trim() === 'PRAGMA optimize') return true
  if (/^\s*select\b/i.test(text)) return true
  return /^\s*with\b/i.test(text) && !WRITES.test(text)
}
