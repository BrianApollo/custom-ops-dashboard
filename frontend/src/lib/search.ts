// Tokenised search: every word typed must appear somewhere in the values, in
// any order and ignoring case, so `fb us keto` finds `Keto - US - FB`.
export const searchWords = (search: string) => search.toLowerCase().split(/\s+/).filter(Boolean)

export function matchesSearch(search: string, ...values: (string | null | undefined)[]) {
  const haystack = values.join(' ').toLowerCase()
  return searchWords(search).every((word) => haystack.includes(word))
}
