# Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `503 ai_not_configured` | No `ANTHROPIC_API_KEY` | Set it and restart |
| `503 stt_not_configured` | Speech-to-text is optional | Set `DEEPGRAM_API_KEY`, or paste a transcript |
| `502 stt_auth_failed` | Invalid Deepgram key | Create a key in the Deepgram console |
| `422 no_speech` | Audio is silent or unsupported | Check the file plays; try MP3/WAV |
| `415` on `/api/transcribe` | Missing/unsupported audio Content-Type | Send e.g. `content-type: audio/mpeg` |
| `400 validation_failed: transcript is too short` | Fewer than 20 characters | Send the full transcript |
| `400` on `date` | Not `YYYY-MM-DD` | Use ISO dates |
| `422 transcript_too_long` | Over `MAX_TRANSCRIPT_LINES` | Raise the limit or split the meeting |
| Owners missing in notes | Transcript has no speaker labels, or nobody was explicitly assigned | Use `Name: text` lines; owners are only kept when the transcript supports them (by design) |
| Speakers not detected | Labels in lower case or longer than four words | Use `Name:` in Title Case, or `[any label]:` |
| Many items under "Removed during verification" | Model paraphrased instead of quoting | Usually rare; re-run, or check the transcript isn't heavily garbled |
| `502 ai_invalid_output` | Very long transcript truncated the output | Split the transcript |
| n8n Drive node: no files | Wrong folder id or permissions | Set `TRANSCRIPTS_FOLDER_ID`; the credential must see the folder |
