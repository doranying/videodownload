# Version 0.1.0

Recorded: 2026-05-18

## Current Features

- Local web app at `http://localhost:4174`.
- Accepts a YouTube video URL.
- Reads available YouTube subtitle languages using the Android player client path.
- Supports official subtitles and YouTube automatic captions.
- Supports subtitle-only download.
- Supports SRT and VTT selection.
- Saves generated files into `downloads/`.
- For videos with no official subtitles, can download original automatic captions such as `ko-orig`.
- If `zh-Hans` automatic translation is blocked or rate-limited, falls back to original captions and shows a notice.
- Browser-side OCR workspace for local videos.
- OCR workspace can load a local video, preview playback, jump 10 seconds, select a subtitle rectangle, sample frames, recognize only that region, merge repeated lines, and export SRT.
- OCR tasks can be cancelled while preview recognition or full SRT generation is running.

## Tested Case

- Video: `https://www.youtube.com/watch?v=y5XMN1Jbt7A`
- `zh-Hans` automatic translated captions may be rate-limited by YouTube.
- `ko-orig` original automatic captions downloaded successfully.
- Generated file: `downloads/_ [y5XMN1Jbt7A].ko-orig.srt`

## Known Limits

- YouTube automatic translated captions such as `zh-Hans` can return HTTP 429 rate limits.
- Downloaded files are saved to the project `downloads/` folder, not macOS `Downloads`, unless the user clicks the file link in the browser.
- Video downloads may be more restricted than subtitle-only downloads.
- OCR uses browser-side Tesseract.js from a CDN, so first use requires network access and model loading time.
- OCR quality depends on subtitle size, contrast, frame interval, and how tightly the subtitle region is selected.
