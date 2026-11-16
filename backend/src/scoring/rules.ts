// The placeholder video check. Edit this list to change what is checked:
// add, remove or retune a rule here, and nothing else needs to change.
// What the rules should judge is described in SKILL.md.
//
// A video starts at START_SCORE and loses each failed rule's penalty; the
// score never goes below 1. Each rule returns pass(detail) or fail(detail),
// and the detail becomes that rule's line in the Score Notes.

import { fail, pass, type Rule } from './rule'

export const START_SCORE = 10

const MB = 1024 * 1024

export const RULES: Rule[] = [
  {
    name: 'Length',
    penalty: 3,
    check: ({ durationSeconds: s }) => {
      if (s === undefined) return fail('could not be read from the file')
      const length = `${Math.round(s)} s`
      return s >= 10 && s <= 180 ? pass(length) : fail(`${length}, should be 10 s to 3 min`)
    },
  },
  {
    name: 'Frame shape',
    penalty: 3,
    check: ({ width, height, format }) => {
      if (!width || !height) return fail('frame size could not be read from the file')
      const size = `${width}×${height}`
      const shape = width === height ? 'Square' : width > height ? 'YouTube' : 'Vertical'
      if (!format) return pass(`${size}, the video has no format to compare with`)
      return shape === format ? pass(`${size} fits ${format}`) : fail(`${size} does not fit ${format}`)
    },
  },
  {
    name: 'File size',
    penalty: 2,
    check: ({ fileSizeBytes: bytes }) => {
      if (bytes === undefined) return fail('unknown')
      const size = `${Math.round(bytes / MB)} MB`
      return bytes < 1024 * MB ? pass(size) : fail(`${size}, should be under 1 GB`)
    },
  },
]
