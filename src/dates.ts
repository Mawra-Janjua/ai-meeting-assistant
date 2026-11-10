// Deterministic deadline → calendar date resolution. The model copies deadlines
// as spoken ("by Friday"); this module turns them into YYYY-MM-DD relative to the
// meeting date. Pure code, no model involvement: anything it cannot resolve
// unambiguously becomes null.

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

const NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fourteen: 14, thirty: 30 };

const DAY = 86_400_000;

/** Parses a strict YYYY-MM-DD string as a UTC date, or null if it is not a real calendar date. */
function parseIso(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? makeDate(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

function makeDate(y: number, month: number, day: number): Date | null {
  const d = new Date(Date.UTC(y, month - 1, day));
  return d.getUTCFullYear() === y && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? d : null;
}

const fmt = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

/** Next date with the given weekday on or after `from`. */
function onOrAfter(from: Date, weekday: number) {
  return addDays(from, (weekday - from.getUTCDay() + 7) % 7);
}

/** Monday of the (Monday-based) week containing `d`. */
function mondayOf(d: Date) {
  return addDays(d, -((d.getUTCDay() + 6) % 7));
}

/** Weekday within the week after the meeting's week ("next Friday"). */
function inNextWeek(meeting: Date, weekday: number) {
  return addDays(mondayOf(meeting), 7 + ((weekday + 6) % 7));
}

/** Explicit day + month; the year comes from the meeting date, rolled forward if that day already passed. */
function dayMonth(meeting: Date, month: number, day: number, year?: number): Date | null {
  if (year !== undefined) return makeDate(year, month, day);
  const sameYear = makeDate(meeting.getUTCFullYear(), month, day);
  if (!sameYear) return null;
  return sameYear < meeting ? makeDate(meeting.getUTCFullYear() + 1, month, day) : sameYear;
}

function clean(deadline: string) {
  let s = deadline
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[.,!?;"()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Leading connectives: "by", "before", "on", "due", "until", "no later than", "at the latest by" …
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(/^(by|before|on|due|until|till|til|no later than|latest|at the latest|at|for|the|this|this coming|coming)\s+/, "");
  }
  // Trailing time-of-day qualifiers: "Friday EOD", "Monday morning", "Thursday at the latest".
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(/\s+(eod|cob|end of day|close of business|morning|afternoon|evening|night|noon|at the latest|latest|at \d{1,2}(:\d{2})?\s*(am|pm)?|\d{1,2}(:\d{2})?\s*(am|pm))$/, "");
  }
  return s.trim();
}

/**
 * Resolves a spoken deadline to YYYY-MM-DD relative to the meeting date.
 * Returns null when there is no (valid) meeting date or the phrase is not understood.
 *
 * Supported: today / tonight / end of day, tomorrow, day after tomorrow, weekday names
 * ("Friday" = next Friday on or after the meeting date; "next Friday" = Friday of the
 * following week), end of (the) week (Friday), end of next week, end of (the) month,
 * in N days/weeks, ISO dates, "12 March", "March 12th", "12th of March 2027", "the 14th".
 */
export function resolveDueDate(deadline: string | null | undefined, meetingDate: string | null | undefined): string | null {
  if (!deadline || !meetingDate) return null;
  const meeting = parseIso(meetingDate);
  if (!meeting) return null;
  const s = clean(deadline);
  if (!s) return null;

  const iso = parseIso(s);
  if (iso) return fmt(iso);

  if (/^(today|tonight|eod|cob|end of day|end of today|close of business)$/.test(s)) return fmt(meeting);
  if (s === "tomorrow") return fmt(addDays(meeting, 1));
  if (s === "day after tomorrow") return fmt(addDays(meeting, 2));

  if (/^(end of( the)? week|eow|week's end|end of this week)$/.test(s)) return fmt(onOrAfter(meeting, 5));
  if (/^end of next week$/.test(s)) return fmt(inNextWeek(meeting, 5));
  if (/^(end of( the)? month|eom|month end|month's end|end of this month)$/.test(s)) {
    return fmt(new Date(Date.UTC(meeting.getUTCFullYear(), meeting.getUTCMonth() + 1, 0)));
  }

  let m = /^in (\d{1,3}|[a-z]+) (day|days|week|weeks)( time)?$/.exec(s);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBERS[m[1]];
    if (n === undefined) return null;
    return fmt(addDays(meeting, m[2].startsWith("week") ? n * 7 : n));
  }

  m = /^(next )?([a-z]+)( next week| week)?$/.exec(s);
  if (m && m[2] in WEEKDAYS) {
    const wd = WEEKDAYS[m[2]];
    return fmt(m[1] || m[3] === " next week" ? inNextWeek(meeting, wd) : onOrAfter(meeting, wd));
  }

  // "12 March", "12th of March", "12 March 2027"
  m = /^(\d{1,2})(?:st|nd|rd|th)?(?: of)? ([a-z]+)(?: (\d{4}))?$/.exec(s);
  if (m && m[2] in MONTHS) return orNull(dayMonth(meeting, MONTHS[m[2]], Number(m[1]), m[3] ? Number(m[3]) : undefined));
  // "March 12", "March 12th", "March 12 2027"
  m = /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(s);
  if (m && m[1] in MONTHS) return orNull(dayMonth(meeting, MONTHS[m[1]], Number(m[2]), m[3] ? Number(m[3]) : undefined));
  // "the 14th" (after clean() removed "the") — day of the meeting's month, or next month if already passed.
  m = /^(\d{1,2})(st|nd|rd|th)$/.exec(s);
  if (m) {
    const day = Number(m[1]);
    const thisMonth = makeDate(meeting.getUTCFullYear(), meeting.getUTCMonth() + 1, day);
    if (thisMonth && thisMonth >= meeting) return fmt(thisMonth);
    const next = new Date(Date.UTC(meeting.getUTCFullYear(), meeting.getUTCMonth() + 1, 1));
    return orNull(makeDate(next.getUTCFullYear(), next.getUTCMonth() + 1, day));
  }
  return null;
}

const orNull = (d: Date | null) => (d ? fmt(d) : null);
