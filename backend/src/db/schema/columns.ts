import { integer, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

// Airtable record id (`rec` + 14 chars), kept as the primary key
export const id = () => text('id').primaryKey()

// ISO 8601 UTC strings, as Airtable returns them
export const timestamps = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}

// Airtable omits unchecked boxes, so a missing value is false
export const checkbox = (name: string) => integer(name, { mode: 'boolean' }).notNull().default(false)

// nullable many-to-one link; the parent going away clears it
export const parent = (name: string, table: () => { id: AnySQLiteColumn }) =>
  text(name).references(() => table().id, { onDelete: 'set null' })

// one side of a junction table; either row going away removes the link
export const link = (name: string, table: () => { id: AnySQLiteColumn }) =>
  text(name)
    .notNull()
    .references(() => table().id, { onDelete: 'cascade' })

export const position = (name: string) => integer(name).notNull()
