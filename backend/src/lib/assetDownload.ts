// Pure helpers for the Library download route: which stored keys may be served, and the saved file's name.

export const ASSET_ROOT = 'asset-library/'

// A key the download route may serve: under asset-library/, no empty, dot or backslash segment
export function servableKey(key: unknown): key is string {
  if (typeof key !== 'string' || !key.startsWith(ASSET_ROOT) || key.length <= ASSET_ROOT.length) return false
  if (/[\\\u0000-\u001f]/.test(key)) return false
  return key.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

const slug = (value: string) =>
  value
    .replace(/[\u2122\u00ae\u00a9]/g, '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

// <product>-<kind>-<short id>.<ext>, e.g. brand-clip-01234567.mp4
export function downloadName(product: string | null | undefined, kind: string | null | undefined, assetKey: string, fileKey: string) {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(fileKey)?.[1]?.toLowerCase()
  const short = slug(assetKey.replace(/^ma_/, '')).slice(0, 8) || 'asset'
  const name = [slug(product ?? '') || 'generic', slug(kind ?? '') || 'asset', short].join('-')
  return ext ? `${name}.${ext}` : name
}

// The Content-Disposition value for a name downloadName made (plain ASCII, no quotes)
export const attachment = (name: string) => `attachment; filename="${name.replace(/["\\]/g, '')}"`
