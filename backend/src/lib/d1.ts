import { env } from 'cloudflare:workers'

export type Row = Record<string, unknown>

export const sql = (text: string, ...params: unknown[]) => env.DB.prepare(text).bind(...params)

export const rows = async (statement: D1PreparedStatement) => (await statement.all<Row>()).results

// One round trip, one transaction: every statement applies or none does
export const batch = (statements: D1PreparedStatement[]) => env.DB.batch<Row>(statements)

// Lists go in as a single JSON parameter and are read with json_each, which
// keeps any number of values inside D1's 100-parameter limit
export const list = (values: unknown[]) => JSON.stringify(values)
export const IN_LIST = '(SELECT value FROM json_each(?))'

export const nowIso = () => new Date().toISOString()
