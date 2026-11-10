# Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `503 ai_not_configured` | No `ANTHROPIC_API_KEY` | Set it and restart |
| Server exits: `API_KEY is not set but HOST is 0.0.0.0` | Exposed without authentication | Set `API_KEY` (16+ chars), or `HOST=127.0.0.1` for local-only use |
| Server exits: `API_KEY must be at least 16 characters` | Weak key | `node -e "console.log(crypto.randomUUID())"` |
| `503 stt_not_configured` | Speech-to-text is optional | Set `DEEPGRAM_API_KEY`, or paste a transcript |
| `502 stt_invalid_response` | Deepgram (or a proxy in between) returned non-JSON | Retry; check network proxies |
| `422 idempotency_key_reused` | Same `Idempotency-Key` sent with a different transcript | Use a new key per meeting |
| Every request gets `429` behind a proxy | All clients share the proxy address | Set `TRUST_PROXY=true` (only behind a trusted proxy) |
| `dueDate` is null | No meeting `date`, or the deadline is vague ("soon", "next sprint") | Send `date`; vague deadlines stay as spoken by design |
| `502 stt_auth_failed` | Invalid Deepgram key | Create a key in the Deepgram console |
| `422 no_speech` | Audio is silent or unsupported | Check the file plays; try MP3/WAV |
| `415` on `/api/transcribe` or `/api/meetings/audio` | Missing/unsupported audio Content-Type | Send e.g. `content-type: audio/mpeg` |
| `400 validation_failed: transcript is too short` | Fewer than 20 characters | Send the full transcript |
| `400` on `date` | Not `YYYY-MM-DD` | Use ISO dates |
| `422 transcript_too_long` | Over `MAX_TRANSCRIPT_LINES` | Raise the limit or split the meeting |
| Owners missing in notes | Transcript has no speaker labels, or nobody was explicitly assigned | Use `Name: text` lines; owners are only kept when the transcript supports them (by design) |
| Speakers not detected | Labels in lower case or longer than four words | Use `Name:` in Title Case, `[any label]:`, or the Teams/Zoom layout (name on its own line, e.g. `Sarah Khan  0:03`). Name-only headers without timestamps are recognised only for names that appear at least twice |
| Many items under "Removed during verification" | Model paraphrased instead of quoting | Usually rare; re-run, or check the transcript isn't heavily garbled |
| `502 ai_invalid_output` | Very long transcript truncated the output | Split the transcript |
| n8n webhook returns 401/403 | Header Auth credential missing or wrong header | Create the "Meeting API webhook auth" Header Auth credential and send that header |
| n8n webhook returns 502 | The meeting API failed after 3 tries | Check the API logs; the error message is in the response |
| Gmail draft has no recipient | Attendees were names, not emails | Add attendee emails to `attendees`, or fill in "To" before sending |
| n8n Drive node: no files | Wrong folder id or permissions | Set `TRANSCRIPTS_FOLDER_ID`; the credential must see the folder |
