import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { FollowUp, VerifiedNotes } from "./schemas.ts";

export type MeetingRecord = {
  id: string;
  title: string | null;
  date: string | null;
  attendees: string[];
  speakers: string[];
  format: string;
  lineCount: number;
  transcript: string;
  notes: VerifiedNotes;
  followUp: FollowUp | null;
  createdAt: string;
};

type Row = { id: string; data: string; created_at: string };

export class MeetingStore {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS meetings (id TEXT PRIMARY KEY, title TEXT, data TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
  }

  insert(m: Omit<MeetingRecord, "id" | "createdAt">): MeetingRecord {
    const rec: MeetingRecord = { ...m, id: randomUUID(), createdAt: new Date().toISOString() };
    const { id, createdAt, ...data } = rec;
    this.db.prepare("INSERT INTO meetings (id, title, data, created_at) VALUES (?, ?, ?, ?)").run(id, rec.title, JSON.stringify(data), createdAt);
    return rec;
  }

  get(id: string): MeetingRecord | undefined {
    const row = this.db.prepare("SELECT * FROM meetings WHERE id = ?").get(id) as Row | undefined;
    return row ? { id: row.id, createdAt: row.created_at, ...(JSON.parse(row.data) as Omit<MeetingRecord, "id" | "createdAt">) } : undefined;
  }

  list(limit: number) {
    return (this.db.prepare("SELECT * FROM meetings ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]).map((r) => {
      const d = JSON.parse(r.data) as MeetingRecord;
      return { id: r.id, title: d.title, date: d.date, decisions: d.notes.decisions.length, actionItems: d.notes.actionItems.length, createdAt: r.created_at };
    });
  }

  close() {
    this.db.close();
  }
}
