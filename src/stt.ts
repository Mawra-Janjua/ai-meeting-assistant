// Optional speech-to-text via Deepgram's pre-recorded audio API (speaker diarization on).
// Enabled only when DEEPGRAM_API_KEY is set.
import { HttpError } from "./http.ts";

export interface SpeechToText {
  transcribe(audio: Buffer, mimeType: string): Promise<{ transcript: string; durationSeconds: number | null; speakers: number }>;
}

export const AUDIO_TYPES = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/webm", "audio/ogg", "audio/flac", "video/mp4", "video/webm"];

type Utterance = { speaker?: number; transcript: string; start?: number };

export class DeepgramSTT implements SpeechToText {
  private apiKey: string;
  private model: string;
  private fetchImpl: typeof fetch;
  constructor(apiKey: string, opts: { model?: string; fetchImpl?: typeof fetch } = {}) {
    this.apiKey = apiKey;
    this.model = opts.model ?? "nova-3";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async transcribe(audio: Buffer, mimeType: string) {
    const params = new URLSearchParams({ model: this.model, smart_format: "true", diarize: "true", utterances: "true", punctuate: "true" });
    let res: Response;
    try {
      res = await this.fetchImpl(`https://api.deepgram.com/v1/listen?${params}`, {
        method: "POST",
        headers: { authorization: `Token ${this.apiKey}`, "content-type": mimeType },
        body: new Uint8Array(audio),
        signal: AbortSignal.timeout(600_000),
      });
    } catch {
      throw new HttpError(503, "stt_unreachable", "Could not reach the Deepgram API.");
    }
    if (res.status === 401 || res.status === 403) throw new HttpError(502, "stt_auth_failed", "Deepgram rejected the API key (DEEPGRAM_API_KEY).");
    if (res.status === 429) throw new HttpError(503, "stt_rate_limited", "Deepgram rate limit reached. Retry shortly.");
    if (!res.ok) throw new HttpError(502, "stt_error", `Deepgram returned HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    let json: { metadata?: { duration?: number }; results?: { utterances?: Utterance[] } };
    try {
      json = (await res.json()) as typeof json;
    } catch {
      throw new HttpError(502, "stt_invalid_response", "Deepgram returned a response that is not valid JSON.");
    }
    return formatUtterances(json?.results?.utterances ?? [], json?.metadata?.duration ?? null);
  }
}

export function formatUtterances(utterances: Utterance[], durationSeconds: number | null) {
  const lines: string[] = [];
  const speakers = new Set<number>();
  for (const u of utterances) {
    const text = u.transcript.trim();
    if (!text) continue;
    const label = u.speaker === undefined ? "Speaker" : `Speaker ${u.speaker + 1}`;
    if (u.speaker !== undefined) speakers.add(u.speaker);
    lines.push(`${label}: ${text}`);
  }
  if (lines.length === 0) throw new HttpError(422, "no_speech", "No speech was detected in the audio.");
  return { transcript: lines.join("\n"), durationSeconds, speakers: speakers.size };
}
