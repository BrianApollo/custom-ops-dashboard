import { sql } from './d1'

// Returned as a statement so it rides in the same batch as the write it records
export const auditStatement = (
  at: string,
  userId: string | null,
  action: string,
  tableName: string | null,
  recordId: string | null,
  detail: unknown = null,
) =>
  sql(
    'INSERT INTO audit_log (at, user_id, action, table_name, record_id, detail) VALUES (?, ?, ?, ?, ?, ?)',
    at,
    userId,
    action,
    tableName,
    recordId,
    detail === null ? null : JSON.stringify(detail),
  )
