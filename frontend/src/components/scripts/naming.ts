import type { ApiRecord } from '../../lib/api'

// How scripts are named and numbered:
//   {Product} - Script 1001 - {Author}          a script, or hook 1 of a script with hooks
//   {Product} - Script 1001 Hk2 - {Author}      hook 2 of the same script, and so on
// Each product numbers its scripts from 1001. Videos are named after their script and files
// are stored under the video's name, so these rules must not drift.

// one below the first number a product hands out
const BEFORE_FIRST = 1000

// the fields the helpers below read
export const NUMBERING_FIELDS = 'Name,Hook,Body,Hook Number,Base Script Number,Source'

// Scripts made by the Ad Lab upload. They number themselves from their own high blocks (7001,
// 9001…), so manual numbering leaves them out. Their name is checked too, for an upload that
// does not send Source yet.
export const isAutomation = (record: ApiRecord) => record.fields.Source === 'automation' || /-\s*AdLab\s*$/i.test(nameOf(record))

const nameOf = (record: ApiRecord) => String(record.fields.Name ?? '')

// the NNNN of `Script NNNN` in a name
export function numberInName(name: string) {
  const match = /Script\s+(\d+)/i.exec(name)
  return match ? Number(match[1]) : null
}

// A script's number. Older scripts carry it only in their name.
export function baseNumber(record: ApiRecord) {
  const stored = record.fields['Base Script Number']
  return typeof stored === 'number' ? stored : numberInName(nameOf(record))
}

// Which hook of its script a record is, null for a script that has not been split into hooks
export function hookNumber(record: ApiRecord) {
  const stored = record.fields['Hook Number']
  if (typeof stored === 'number') return stored
  const match = /Script\s+\d+\s+Hk(\d+)/i.exec(nameOf(record))
  return match ? Number(match[1]) : null
}

// The number for a product's next manual script, given every script it has
export function nextScriptNumber(scripts: ApiRecord[]) {
  const manual = scripts.filter((script) => !isAutomation(script)).map((script) => baseNumber(script) ?? 0)
  return Math.max(BEFORE_FIRST, ...manual) + 1
}

// Hook 1 has no suffix: it is the script itself
export function scriptName(productName: string, number: number, authorName: string, hook = 1) {
  return `${productName} - Script ${String(number).padStart(4, '0')}${hook >= 2 ? ` Hk${hook}` : ''} - ${authorName}`
}

// The name of another hook of an existing script, built from that script's own name so the
// product and author parts stay exactly as they were written
export function hookName(scriptName: string, hook: number) {
  return scriptName.replace(/(Script\s+\d+)(\s+Hk\d+)?/i, hook >= 2 ? `$1 Hk${hook}` : '$1')
}
