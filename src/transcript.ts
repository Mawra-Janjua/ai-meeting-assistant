// Parses plain-text, WebVTT and SRT transcripts into numbered lines that the
// model must cite, so every extracted item can be traced back and verified.

export type Line = { n: number; speaker: string | null; text: string; time: string | null };
export type Transcript = { lines: Line[]; speakers: string[]; format: "vtt" | "srt" | "text" };

const TIMESTAMP = /(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}/;
// "Sarah:", "Sarah Khan:", "Dr. O'Neil:", "[any label]:", "SPEAKER 1:" — up to four Title-Case words,
// so sentences such as "The plan for today is this: …" are not mistaken for speakers.
const SPEAKER_PREFIX = /^\s*(?:\[([^\]\n]{1,40})\]|(\p{Lu}[\p{L}'.\-]{0,20}(?: \p{Lu}[\p{L}'.\-]{0,20}){0,3}|Speaker \d+|SPEAKER \d+))\s*:\s*(.+)$/u;
const VTT_VOICE = /^<v(?:\.[^\s>]*)?\s+([^>]+)>(.*?)(?:<\/v>)?$/;
// Every voice span in a cue: "<v Tom>Hi.</v> <v Priya>Hello.</v>" (also "<v.loud Tom>").
const VTT_VOICES = /<v(?:\.[^\s>]*)?\s+([^>]+)>([\s\S]*?)(?:<\/v>|(?=<v[\s.])|$)/g;
// Teams / Zoom exports put the speaker on its own line, optionally with a timestamp:
// "Sarah Khan   0:03", "[Sarah Khan] 10:02:33", "00:01:02 Sarah Khan", "Sarah Khan (0:03)".
const CLOCK = String.raw`[\[(]?(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)[\])]?`;
const NAME = String.raw`\[([^\]\n]{1,40})\]|(\p{Lu}[\p{L}'.\-]{0,20}(?: \p{Lu}[\p{L}'.\-]{0,20}){0,3}|Speaker \d+|SPEAKER \d+)`;
const NAME_LINE = new RegExp(String.raw`^\s*(?:${CLOCK}\s+)?(?:${NAME})(?:\s+${CLOCK})?\s*$`, "u");
// Short replies that look like a name on their own line but are utterances.
const NOT_NAMES = new Set(["yes", "no", "yeah", "yep", "nope", "okay", "ok", "sure", "agreed", "thanks", "thank you", "right", "great", "fine", "cool", "exactly", "absolutely", "perfect", "good", "nice", "hi", "hello", "bye", "morning", "same", "true", "correct", "done", "got it", "sounds good"]);

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

type NameHeader = { speaker: string; time: string | null };

function nameHeader(l: string): NameHeader | null {
  const m = NAME_LINE.exec(l);
  if (!m) return null;
  const speaker = (m[2] ?? m[3]).trim();
  if (speaker.endsWith(".") || NOT_NAMES.has(speaker.toLowerCase())) return null;
  return { speaker, time: m[1] ?? m[4] ?? null };
}

/**
 * Detects the "name on its own line, utterance below" layout (Teams / Zoom). Used only when the
 * transcript starts with such a header, they outnumber "Name: text" lines, and each header is
 * timestamped or names someone who appears as a header at least twice.
 */
function nameHeaderLayout(rows: string[]): Set<number> | null {
  const headers = new Map<number, NameHeader>();
  for (const [i, r] of rows.entries()) {
    const h = nameHeader(r);
    const next = rows[i + 1];
    if (h && next !== undefined && !nameHeader(next)) headers.set(i, h);
  }
  if (!headers.has(0) || headers.size < 2) return null;
  if (rows.filter((r) => SPEAKER_PREFIX.test(r)).length >= headers.size) return null;
  const counts = new Map<string, number>();
  for (const h of headers.values()) counts.set(h.speaker, (counts.get(h.speaker) ?? 0) + 1);
  const accepted = new Set<number>();
  for (const [i, h] of headers) if (h.time || (counts.get(h.speaker) ?? 0) >= 2) accepted.add(i);
  return accepted.has(0) && accepted.size >= 2 ? accepted : null;
}

export function parseTranscript(raw: string): Transcript {
  const format = detectFormat(raw);
  const out: Omit<Line, "n">[] = [];
  const blocks = raw.replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  const rows = blocks.split("\n").filter((l) => l.trim());
  const layout = format === "text" ? nameHeaderLayout(rows) : null;

  if (layout) {
    let current: NameHeader | null = null;
    for (const [i, l] of rows.entries()) {
      if (layout.has(i)) current = nameHeader(l);
      else out.push({ speaker: current?.speaker ?? null, text: l.trim(), time: current?.time ?? null });
    }
  } else if (format === "text") {
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
      const voices = [...content.matchAll(VTT_VOICES)];
      if (voices.length > 1) {
        // Several speakers in one cue: one line per voice.
        const lead = content.slice(0, voices[0].index).replace(/<[^>]+>/g, "").trim();
        if (lead) out.push({ ...splitSpeaker(lead), time });
        for (const v of voices) out.push({ speaker: v[1].trim(), text: v[2].replace(/<[^>]+>/g, "").trim(), time });
        continue;
      }
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
