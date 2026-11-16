// A video's file is stored under the record's name, never the name the file had
// on the uploader's computer: `{Video Name}.{ext}`, with slashes and control
// characters turned into `-` and the extension taken from the uploaded file.
// The browser builds the name the same way (videoFileName in the frontend).
export function storedBaseName(videoName: unknown) {
  return typeof videoName === 'string' ? videoName.trim().replace(/[/\\\u0000-\u001f]/g, '-') : ''
}

// Whether `fileName` is the name a file of this video would be stored under.
// The extension is free; everything before the last dot must be the record's name.
export function fileNameMatchesVideo(fileName: unknown, videoName: unknown) {
  if (typeof fileName !== 'string') return false
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0 || dot === fileName.length - 1) return false
  const base = storedBaseName(videoName)
  return base !== '' && fileName.slice(0, dot) === base
}
