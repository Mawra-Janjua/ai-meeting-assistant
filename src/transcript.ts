// Parses plain-text, WebVTT and SRT transcripts into numbered lines that the
// model must cite, so every extracted item can be traced back and verified.

export type Line = { n: number; speaker: string | null; text: string; time: string | null };
export type Transcript = { lines: Line[]; speakers: string[]; format: "vtt" | "srt" | "text" };

const TIMESTAMP = /(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}/;
// "Sarah:", "Sarah Khan:", "Dr. O'Neil:", "[any label]:", "SPEAKER 1:" — up to four Title-Case words,
// so sentences such as "The plan for today is this: …" are not mistaken for speakers.
const SPEAKER_PREFIX = /^\s*(?:\[([^\]\n]{1,40})\]|(\p{Lu}[\p{L}'.\-]{0,20}(?: \p{Lu}[\p{L}'.\-]{0,20}){0,3}|Speaker \d+|SPEAKER \d+))\s*:\s*(.+)$/u;
const VTT_VOICE = /^<v\s+([^>]+)>(.*?)(?:<\/v>)?$/;

export function detectFormat(raw: string): Transcript["format"] {
  if (/^﻿?WEBVTT/.test(raw.trimStart())) return "vtt";
  if (TIMESTAMP.test(raw) && /^\d+\s*$/m.test(raw)) return "srt";
  return "text";
}

function splitSpeaker(text: string): { speaker: string | null; text: string } {
  const voice = VTT_VOICE.exec(text);
  if (voice) return { speaker: voice[1].trim(), text: voice[2].trim() };
  const m = SPEAKER_PREFIX.exec(text);
  if (m) return { speaker: (m[1] ?? m[2]).trim(), text: m[3].trim() };
  return { speaker: null, text: text.trim() };
}

export function parseTranscript(raw: string): Transcript {
  const format = detectFormat(raw);
  const out: Omit<Line, "n">[] = [];
  const blocks = raw.replace(/\r\n?/g, "\n").replace(/^﻿/, "");

  if (format === "text") {
    for (const l of blocks.split("\n")) {
      if (!l.trim()) continue;
      const { speaker, text } = splitSpeaker(l);
      // Continuation lines inherit the previous speaker.
      out.push({ speaker: speaker ?? (out.length && !SPEAKER_PREFIX.test(l) ? out[out.length - 1].speaker : null), text, time: null });
    }
  } else {
    for (const block of blocks.split(/\n{2,}/)) {
      const rows = block.split("\n").map((r) => r.trim()).filter(Boolean);
      const tsIndex = rows.findIndex((r) => TIMESTAMP.test(r));
      if (tsIndex === -1) continue; // header, NOTE, STYLE blocks
      const time = rows[tsIndex].split("-->")[0].trim().replace(",", ".");
      const content = rows.slice(tsIndex + 1).join(" ");
      if (!content) continue;
      const { speaker, text } = splitSpeaker(content);
      out.push({ speaker, text: text.replace(/<[^>]+>/g, ""), time });
    }
  }

  const lines = out.filter((l) => l.text).map((l, i) => ({ ...l, n: i + 1 }));
  const speakers = [...new Set(lines.map((l) => l.speaker).filter((s): s is string => !!s))];
  return { lines, speakers, format };
}

/** The numbered form the model sees, e.g. "[L12] Sarah: We'll ship Friday." */
export function numbered(t: Transcript) {
  return t.lines.map((l) => `[L${l.n}]${l.time ? ` (${l.time})` : ""} ${l.speaker ? `${l.speaker}: ` : ""}${l.text}`).join("\n");
}

/** Lowercase, strip punctuation and collapse spaces, for tolerant quote matching. */
export function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
