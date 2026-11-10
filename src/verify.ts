// Checks every decision and action item against the transcript.
// - The cited quote must really be in the transcript (else the item is rejected).
// - An owner must be named in the cited line's context (speaker or text); otherwise owner = null.
// - A deadline must be said in that context (whole words); otherwise deadline = null.
// - The item's own text must share key words with the cited line (± one line), so a
//   real quote cannot "support" an unrelated, invented decision or task.
import { normalize, type Transcript } from "./transcript.ts";
import { resolveDueDate } from "./dates.ts";
import type { Notes, Rejected, VerifiedAction, VerifiedDecision, VerifiedNotes } from "./schemas.ts";

const CONTEXT = 2; // lines either side of the cited line
/** Minimum normalised quote length: shorter quotes ("yes", "ok then") match almost anywhere. */
export const MIN_QUOTE_CHARS = 12;

function locateQuote(t: Transcript, line: number, quote: string): number | null {
  const q = normalize(quote);
  if (q.length < MIN_QUOTE_CHARS) return null;
  const inLine = (n: number) => {
    const l = t.lines[n - 1];
    return l ? normalize(l.text).includes(q) : false;
  };
  if (inLine(line)) return line;
  for (const d of [-1, 1]) if (inLine(line + d)) return line + d;
  // Quote spanning two consecutive caption lines.
  for (const n of [line - 1, line]) {
    const a = t.lines[n - 1];
    const b = t.lines[n];
    if (a && b && normalize(`${a.text} ${b.text}`).includes(q)) return n;
  }
  const anywhere = t.lines.find((l) => normalize(l.text).includes(q));
  return anywhere ? anywhere.n : null;
}

function context(t: Transcript, line: number) {
  return t.lines.slice(Math.max(0, line - 1 - CONTEXT), line + CONTEXT);
}

const PRONOUNS = new Set(["i", "me", "we", "us", "you", "they", "them", "someone", "everyone", "team", "the team", "tbd", "unassigned"]);

/** First-person commitments: "I'll …", "I can …", "let me …", "will do", "on it". */
const COMMITMENT = /(^| )(i'll|i will|i can|i'm going to|i am going to|let me|i'll take|i'll handle|will do|i've got it|on it|i'll own)( |$)/;

const firstName = (s: string) => normalize(s).split(" ")[0];
const words = (s: string) => ` ${normalize(s)} `;

/**
 * Returns the owner as written in the transcript, or null if the transcript does not support it.
 * Supported when the owner is (a) named in the cited line or the line just before it
 * ("Daniel, can you…" / "Ali will send it"), or (b) the speaker of the cited line and that
 * line is a first-person commitment ("I'll send the drafts by Monday").
 */
export function verifyOwner(t: Transcript, line: number, owner: string | null, attendees: string[] = []): string | null {
  if (!owner) return null;
  const o = normalize(owner);
  if (!o || PRONOUNS.has(o)) return null;
  const cited = t.lines[line - 1];
  if (!cited) return null;
  const people = [...new Set([...t.speakers, ...attendees])];
  // Resolve "Daniel Smith" → "Daniel" when only the first name is known, and vice versa.
  const person = people.find((p) => normalize(p) === o) ?? people.find((p) => firstName(p) === firstName(o)) ?? null;

  // (b) speaker of a first-person commitment
  if (person && cited.speaker && normalize(cited.speaker) === normalize(person) && COMMITMENT.test(normalize(cited.text))) return person;

  // (a) named in the cited line or the line before it
  const named = [t.lines[line - 2], cited].filter(Boolean).some((l) => words(l!.text).includes(` ${o} `) || words(l!.text).includes(` ${firstName(o)} `));
  if (named) return person ?? owner;
  return null;
}

/** Date words that are also ordinary English words ("you may…", "march on", "the sun"). */
const AMBIGUOUS_DATE_WORDS = new Set(["may", "march", "sat", "sun", "wed", "mon", "jan", "dec", "aug"]);

/**
 * Whole-word, case-insensitive match in the cited line's context: "Mon" does not match "money".
 * A deadline that is only an ambiguous word ("May") must also appear capitalised, so the verb
 * "may" does not count as the month.
 */
export function verifyDeadline(t: Transcript, line: number, deadline: string | null): string | null {
  if (!deadline) return null;
  const d = normalize(deadline);
  if (!d) return null;
  const ambiguous = AMBIGUOUS_DATE_WORDS.has(d);
  const capitalised = new RegExp(`(^|[^\\p{L}])${d[0].toUpperCase()}${d.slice(1)}([^\\p{L}]|$)`, "u");
  return context(t, line).some((l) => words(l.text).includes(` ${d} `) && (!ambiguous || capitalised.test(l.text))) ? deadline : null;
}

const STOPWORDS = new Set(
  ("about above after again also been before being below between both could does doing down during each from further have having here " +
    "into just more most need needs once only other over same should some such than that their them then there these they this those " +
    "through under until very were what when where which while will with would your yours ours okay yeah sure maybe really think going " +
    "make sure something someone everyone team meeting today tomorrow week let's lets agree agreed decide decided decision task item").split(" "),
);

/** Light stemming so "drafted" ~ "drafts" ~ "draft" and "shipping" ~ "ship". */
function stem(w: string) {
  for (const suf of ["ing", "ed", "es", "s"]) if (w.endsWith(suf) && w.length - suf.length >= 4) return w.slice(0, -suf.length);
  return w;
}

/** Content words: 4+ letters (or containing a digit, e.g. "14th"), minus stopwords, stemmed. */
export function contentWords(s: string) {
  return new Set(
    normalize(s)
      .split(" ")
      .map((w) => w.replace(/'s$/, "").replace(/'/g, ""))
      .filter((w) => (w.length >= 4 || /\d/.test(w)) && !STOPWORDS.has(w))
      .map(stem),
  );
}

/** True when the item text shares at least one content word with the quote or the cited line ± 1. */
export function supportsText(t: Transcript, line: number, quote: string, text: string): boolean {
  const item = contentWords(text);
  if (item.size === 0) return true; // nothing checkable (e.g. "Go") — the quote check already passed
  const source = new Set([quote, ...t.lines.slice(Math.max(0, line - 2), line + 1).map((l) => l.text)].flatMap((s) => [...contentWords(s)]));
  for (const w of item) if (source.has(w)) return true;
  return false;
}

const UNRELATED = "Text shares no key words with the cited line — the quote does not support it";

export function verifyNotes(notes: Notes, t: Transcript, attendees: string[] = [], meetingDate?: string | null): VerifiedNotes {
  const rejected: Rejected[] = [];

  const decisions: VerifiedDecision[] = [];
  for (const d of notes.decisions) {
    const line = locateQuote(t, d.evidence_line, d.evidence_quote);
    if (line === null) rejected.push({ kind: "decision", text: d.decision, reason: "Cited quote not found in the transcript" });
    else if (!supportsText(t, line, d.evidence_quote, d.decision)) rejected.push({ kind: "decision", text: d.decision, reason: UNRELATED });
    else decisions.push({ decision: d.decision, line, quote: d.evidence_quote });
  }

  const actionItems: VerifiedAction[] = [];
  const seen = new Set<string>();
  for (const a of notes.action_items) {
    const line = locateQuote(t, a.evidence_line, a.evidence_quote);
    if (line === null) {
      rejected.push({ kind: "action_item", text: a.task, reason: "Cited quote not found in the transcript" });
      continue;
    }
    if (!supportsText(t, line, a.evidence_quote, a.task)) {
      rejected.push({ kind: "action_item", text: a.task, reason: UNRELATED });
      continue;
    }
    const key = normalize(a.task);
    if (seen.has(key)) continue;
    seen.add(key);
    const owner = verifyOwner(t, line, a.owner, attendees);
    const deadline = verifyDeadline(t, line, a.deadline);
    const itemNotes: string[] = [];
    if (a.owner && !owner) itemNotes.push(`Owner "${a.owner}" is not stated near the cited line — left unassigned.`);
    if (a.deadline && !deadline) itemNotes.push(`Deadline "${a.deadline}" is not stated near the cited line — removed.`);
    actionItems.push({ task: a.task, owner, deadline, dueDate: resolveDueDate(deadline, meetingDate), line, quote: a.evidence_quote, notes: itemNotes });
  }

  return { summary: notes.summary, keyPoints: notes.key_points, decisions, actionItems, openQuestions: notes.open_questions, rejected };
}
