import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// One row per file in an Airtable attachment field. `table_name` + `record_id`
// point at the owning row in any table, so there is no foreign key here.
export const attachments = sqliteTable(
  'attachments',
  {
    // Airtable's `att…` id; the dashboard uses it as a stable key
    id: text('id').primaryKey(),
    tableName: text('table_name').notNull(),
    recordId: text('record_id').notNull(),
    // the D1-side field name, e.g. `product_images`
    fieldName: text('field_name').notNull(),
    position: integer('position').notNull(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    width: integer('width'),
    height: integer('height'),
    r2Key: text('r2_key').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_attachments_owner').on(t.tableName, t.recordId, t.fieldName, t.position)],
)
