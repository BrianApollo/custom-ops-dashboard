// The pure half of storage.ts: no settings import, so tests can load it.

// The key goes into the link as is, spaces included, because that is how every
// link already stored in the data is written (`…/GhostWing/Videos/GhostWing - Script 1039 - ….mp4`).
// Only the three characters that would change the meaning of the URL are escaped;
// Airtable file names, for one, contain a literal `%20`.
export const urlPath = (key: string) => key.replace(/[%#?]/g, (c) => encodeURIComponent(c))

// The public address of `key` under `base` (the PUBLIC_FILES_URL setting)
export const linkFor = (base: string, key: string) => `${base.replace(/\/$/, '')}/${urlPath(key)}`

// The address of a stored key, or null when there is no key or no public base to build it on
export function linkOrNull(base: string | undefined, key: unknown) {
  if (!base || typeof key !== 'string' || key.trim() === '') return null
  return linkFor(base, key)
}
