import { HttpError } from "./http.ts";
import { numbered, parseTranscript } from "./transcript.ts";
import { verifyNotes } from "./verify.ts";
import type { MeetingAI } from "./ai.ts";
import type { SpeechToText } from "./stt.ts";
import type { MeetingRecord, MeetingStore } from "./store.ts";
import { MeetingInputSchema, type MeetingInput } from "./schemas.ts";

export type ServiceDeps = { store: MeetingStore; ai: MeetingAI | null; stt: SpeechToText | null; sender: string; maxLines: number };

export type MeetingMetaInput = Omit<MeetingInput, "transcript">;
export type CreateResult = { meeting: MeetingRecord; replayed: boolean };

export class MeetingService {
  private d: ServiceDeps;
  /** Requests still being processed, by idempotency key, so a concurrent retry waits for the same result. */
  private inflight = new Map<string, Promise<MeetingRecord>>();
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
    const notes = verifyNotes(raw, t, input.attendees ?? [], input.date);
    // Only draft an email when there is something to follow up on (the summary alone is not enough).
    const hasFollowUps = notes.decisions.length > 0 || notes.actionItems.length > 0 || notes.openQuestions.length > 0;
    const followUp = opts.followUp && hasFollowUps ? await this.d.ai.followUp(notes, meta, this.d.sender) : null;
    return { transcript: t, notes, followUp };
  }

  async create(input: MeetingInput, opts: { followUp: boolean }, idempotencyKey?: string) {
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
    }, idempotencyKey);
  }

  /**
   * Create a meeting at most once per idempotency key: a repeat returns the stored meeting
   * (or waits for the in-flight one) instead of calling Claude again and storing a duplicate.
   */
  async createIdempotent(input: MeetingInput, opts: { followUp: boolean }, key?: string): Promise<CreateResult> {
    return this.once(key, (m) => m.transcript === input.transcript, () => this.create(input, opts, key));
  }

  /** Audio → Deepgram transcript → the same summarise + verify pipeline → stored meeting. */
  async createFromAudio(audio: Buffer, mimeType: string, meta: MeetingMetaInput, opts: { followUp: boolean }, key?: string): Promise<CreateResult> {
    if (!this.d.stt) throw new HttpError(503, "stt_not_configured", "Speech-to-text is not configured. Set DEEPGRAM_API_KEY to enable /api/meetings/audio, or upload a transcript instead.");
    if (!this.d.ai) throw new HttpError(503, "ai_not_configured", "Claude is not configured. Set ANTHROPIC_API_KEY.");
    if (audio.length === 0) throw new HttpError(400, "empty_file", "The audio file is empty.");
    return this.once(key, null, async () => {
      const { transcript } = await this.d.stt!.transcribe(audio, mimeType);
      return this.create(MeetingInputSchema.parse({ ...meta, transcript }), opts, key);
    });
  }

  private async once(key: string | undefined, sameInput: ((m: MeetingRecord) => boolean) | null, run: () => Promise<MeetingRecord>): Promise<CreateResult> {
    if (!key) return { meeting: await run(), replayed: false };
    const pending = this.inflight.get(key);
    if (pending) return { meeting: await pending, replayed: true };
    const stored = this.d.store.getByIdempotencyKey(key);
    if (stored) {
      if (sameInput && !sameInput(stored)) {
        throw new HttpError(422, "idempotency_key_reused", "This Idempotency-Key was already used for a different transcript.");
      }
      return { meeting: stored, replayed: true };
    }
    const p = run();
    this.inflight.set(key, p);
    try {
      return { meeting: await p, replayed: false };
    } finally {
      this.inflight.delete(key);
    }
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
