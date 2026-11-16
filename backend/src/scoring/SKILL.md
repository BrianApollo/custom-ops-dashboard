---
name: video-check
description: Scores an uploaded editor video from 1 to 10 and writes short notes for the admin who reviews it.
---

# Video check

Runs automatically each time a video editor uploads or replaces a video file
(Videos table only). The result is shown to admins only, next to the video, as
**Score** (1 to 10) and **Score Notes**. It never changes the video's status.

## Today: a placeholder check

The real skill is not written yet. Until it is, `rules.ts` scores the file's
basic facts (length, frame shape, size) so the whole flow can be used and
tested. To change what is checked, edit the list in `rules.ts`; nothing else
needs to change.

## How to score (the guide for the real skill)

Edit this section to change how videos are judged. When the real check is
built, this text is what it is told to follow.

- Start from 10 and take points off for each problem.
- Never go below 1.
- 8 to 10: ready for review as it is.
- 5 to 7: usable, with problems an admin should look at.
- 1 to 4: likely to be sent back.

### What to look for

- The video is the right length for an ad (10 seconds to 3 minutes).
- The frame shape matches the format: Vertical is portrait, Square is square,
  YouTube is landscape.
- The file is a reasonable size (under 1 GB).

### How to write the notes

- One line per thing checked, starting with ✓ or ✗.
- Say what was found, with the number (for example "42 s" or "1920×1080").
- For a problem, say what it should be instead.
- Plain words, no more than a sentence per line.
