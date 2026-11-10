import type { FollowUp, VerifiedNotes } from "./schemas.ts";

type Meta = { title: string | null; date: string | null; attendees: string[]; speakers: string[] };

const esc = (s: string) => s.replace(/([\\`*_[\]#|<>])/g, "\\$1");

export function toMarkdown(meta: Meta, n: VerifiedNotes, followUp: FollowUp | null): string {
  const out: string[] = [];
  out.push(`# ${esc(meta.title ?? "Meeting notes")}`, "");
  if (meta.date) out.push(`**Date:** ${meta.date}  `);
  const people = meta.attendees.length ? meta.attendees : meta.speakers;
  if (people.length) out.push(`**Participants:** ${people.map(esc).join(", ")}`);
  out.push("", "## Summary", "", esc(n.summary), "");

  if (n.keyPoints.length) out.push("## Key points", "", ...n.keyPoints.map((p) => `- ${esc(p)}`), "");

  out.push("## Decisions", "");
  if (n.decisions.length) out.push(...n.decisions.map((d) => `- ${esc(d.decision)} _(L${d.line}: "${esc(d.quote)}")_`));
  else out.push("_No decisions were recorded._");
  out.push("");

  out.push("## Action items", "");
  if (n.actionItems.length) {
    out.push("| Task | Owner | Deadline | Source |", "|---|---|---|---|");
    for (const a of n.actionItems) {
      out.push(`| ${esc(a.task)} | ${a.owner ? esc(a.owner) : "_Unassigned_"} | ${a.deadline ? esc(a.deadline) + (a.dueDate ? ` (${a.dueDate})` : "") : "—"} | L${a.line} |`);
    }
  } else out.push("_No action items were recorded._");
  out.push("");

  if (n.openQuestions.length) out.push("## Open questions", "", ...n.openQuestions.map((q) => `- ${esc(q)}`), "");
  if (n.rejected.length) {
    out.push("## Removed during verification", "", ...n.rejected.map((r) => `- ${r.kind === "decision" ? "Decision" : "Action"}: ${esc(r.text)} — ${r.reason}`), "");
  }
  if (followUp) out.push("## Follow-up email draft", "", `**Subject:** ${esc(followUp.subject)}`, "", "```text", followUp.body.replace(/```/g, "'''"), "```", "");
  return out.join("\n");
}
