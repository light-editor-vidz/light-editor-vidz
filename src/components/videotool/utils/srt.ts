// SRT subtitle file parser. Kept intentionally tolerant of minor
// malformations (stray index lines, CRLF, trailing whitespace) since
// SRT files are often hand-edited or exported by third-party tools.

export interface SubtitleCue {
  id: number;
  start: number;
  end: number;
  text: string;
}

const TIME_RE = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function timeToSeconds(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;
}

// <i>, <b>, <font color="…"> and ASS-style {\an8} overrides are common in SRT
// files. Neither the preview nor the burn-in understands them, so they would
// be printed literally on the picture.
function stripMarkup(text: string): string {
  return text.replace(/<\/?[a-zA-Z][^>]*>/g, "").replace(/\{\\[^}]*\}/g, "");
}

export function parseSrt(content: string): SubtitleCue[] {
  const blocks = content.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  const cues: SubtitleCue[] = [];
  let autoId = 1;

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    const timeLineIndex = lines.findIndex((l) => TIME_RE.test(l));
    if (timeLineIndex === -1) continue;

    const match = lines[timeLineIndex].match(TIME_RE)!;
    const start = timeToSeconds(match[1], match[2], match[3], match[4]);
    const end = timeToSeconds(match[5], match[6], match[7], match[8]);
    const text = stripMarkup(lines.slice(timeLineIndex + 1).join("\n")).trim();

    if (!text || end <= start) continue;
    cues.push({ id: autoId++, start, end, text });
  }

  return cues.sort((a, b) => a.start - b.start);
}
