const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

export const RECORD_ID = /^rec[A-Za-z0-9]{14}$/

function random(prefix: string) {
  let id = prefix
  for (const byte of crypto.getRandomValues(new Uint8Array(14))) id += ALPHABET[byte % ALPHABET.length]
  return id
}

// Same formats as Airtable's ids, so new and imported rows look alike
export const recordId = () => random('rec')
export const attachmentId = () => random('att')
