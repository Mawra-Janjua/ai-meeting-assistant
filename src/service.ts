import { HttpError } from "./http.ts";
import { numbered, parseTranscript } from "./transcript.ts";
import { verifyNotes } from "./verify.ts";
import type { MeetingAI } from "./ai.ts";
import type { SpeechToText } from "./stt.ts";
import type { MeetingStore } from "./store.ts";
import type { MeetingInput } from "./schemas.ts";

export type ServiceDeps = { store: MeetingStore; ai: MeetingAI | null; stt: SpeechToText | null; sender: string; maxLines: number };

export class MeetingService {
  private d: ServiceDeps;
  constructor(deps: ServiceDeps) {
    this.d = deps;
  }

  /** Parse → Claude notes → verification → optional follow-up draft. */
  async summarize(input: MeetingInput, opts: { followUp: boolean }) {
    if (!this.d.ai) throw new HttpError(503, "ai_not_configured", "Claude is not configured. Set ANTHROPIC_API_KEY.");
    const t = parseTranscript(input.transcript);
    if (t.lines.length === 0) throw new HttpError(422, "empty_transcript", "No transcript lines were found.");
    if (t.lines.length > this.d.maxLines) throw new HttpError(422, "transcript_too_long", `Transcript has ${t.lines.length} lines; the limit is ${this.d.maxLines}.`);
    const meta = { title: input.title, date: input.date, attendees: input.attendees };
    const raw = await this.d.ai.notes(numbered(t), meta);
    const notes = verifyNotes(raw, t, input.attendees ?? []);
    const followUp = opts.followUp && (notes.decisions.length || notes.actionItems.length || notes.summary) ? await this.d.ai.followUp(notes, meta, this.d.sender) : null;
    return { transcript: t, notes, followUp };
  }

  async create(input: MeetingInput, opts: { followUp: boolean }) {
    const { transcript, notes, followUp } = await this.summarize(input, opts);
    return this.d.store.insert({
      title: input.title ?? null,
      date: input.date ?? null,
      attendees: input.attendees ?? [],
      speakers: transcript.speakers,
      format: transcript.format,
      lineCount: transcript.lines.length,
      transcript: input.transcript,
      notes,
      followUp,
    });
  }

  async transcribe(audio: Buffer, mimeType: string) {
    if (!this.d.stt) throw new HttpError(503, "stt_not_configured", "Speech-to-text is optional and not configured. Set DEEPGRAM_API_KEY, or paste a transcript instead.");
    if (audio.length === 0) throw new HttpError(400, "empty_file", "The audio file is empty.");
    return this.d.stt.transcribe(audio, mimeType);
  }

  mustGet(id: string) {
    const m = this.d.store.get(id);
    if (!m) throw new HttpError(404, "not_found", `Meeting ${id} not found.`);
    return m;
  }
}
