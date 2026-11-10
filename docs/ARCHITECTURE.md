# Architecture

| Module | Responsibility |
|---|---|
| `src/transcript.ts` | Format detection, parsing (text/VTT/SRT), speaker extraction, numbered lines, text normalisation |
| `src/ai.ts`, `src/claude.ts` | Claude notes (with evidence) and follow-up email, structured outputs |
| `src/verify.ts` | Evidence, text/quote overlap, owner and deadline verification; dedupe; rejected-item log |
| `src/dates.ts` | Deterministic spoken deadline → `dueDate` (YYYY-MM-DD) relative to the meeting date |
| `src/stt.ts` | Optional Deepgram pre-recorded transcription with diarization |
| `src/service.ts` | Pipeline orchestration, limits, idempotency (`Idempotency-Key`), audio → transcript → notes |
| `src/export.ts` | Markdown rendering |
| `src/store.ts` | SQLite persistence |

## Pipeline

```mermaid
sequenceDiagram
  participant Client
  participant API
  participant Claude
  Client->>API: transcript (JSON / txt / vtt / srt)
  API->>API: parse → [L1] Sarah: … [L2] Daniel: …
  API->>Claude: notes request (effort medium, JSON schema)
  Claude-->>API: decisions/actions with evidence_line + evidence_quote
  API->>API: verifyNotes() — quotes, owners, deadlines, duplicates
  API->>Claude: follow-up request with verified items only (effort low), only if there are decisions, actions or open questions
  Claude-->>API: subject + body
  API-->>Client: notes, removed items, follow-up, markdown
```

## Verification rules

| Item | Kept when | Otherwise |
|---|---|---|
| Decision / action | Normalised `evidence_quote` (at least 12 characters) is in the cited line, an adjacent line, two consecutive caption lines, or anywhere in the transcript (line number corrected) | Removed, listed under `rejected` with the reason |
| Decision / action text | Shares at least one content word (4+ letters or containing a digit, stopwords removed, light stemming) with the quote or the located line ±1 — a real quote cannot back an invented decision | Removed, listed under `rejected` |
| Owner | Named in the cited line or the line before it ("Daniel, can you…"), **or** the cited line's speaker made a first-person commitment ("I'll…", "I can…", "will do") | `owner: null`, note added |
| Deadline | The deadline words appear as whole words (case-insensitive) within ±2 lines of the cited line; a bare ambiguous word such as "May" must appear capitalised | `deadline: null`, note added |
| Due date | Deadline kept and resolvable by `src/dates.ts` relative to the meeting `date` | `dueDate: null` |
| Pronoun owners ("I", "we", "the team") | Never accepted as names | `owner: null` |

These are deterministic and tested, so the guarantees hold regardless of how the model behaves.
