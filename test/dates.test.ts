import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDueDate } from "../src/dates.ts";

const WED = "2026-11-11"; // a Wednesday

const check = (cases: [string, string | null][]) => {
  for (const [spoken, expected] of cases) assert.equal(resolveDueDate(spoken, WED), expected, `"${spoken}"`);
};

test("relative days", () =>
  check([
    ["today", "2026-11-11"],
    ["by end of day", "2026-11-11"],
    ["tomorrow", "2026-11-12"],
    ["day after tomorrow", "2026-11-13"],
    ["in 3 days", "2026-11-14"],
    ["in two weeks", "2026-11-25"],
    ["in a week", "2026-11-18"],
  ]));

test("weekday names: next occurrence on/after the meeting; 'next X' = the following week", () =>
  check([
    ["Friday", "2026-11-13"],
    ["by Friday", "2026-11-13"],
    ["this Friday", "2026-11-13"],
    ["Fri", "2026-11-13"],
    ["by Friday EOD", "2026-11-13"],
    ["Thursday morning", "2026-11-12"],
    ["Wednesday", "2026-11-11"],
    ["Monday", "2026-11-16"],
    ["next Friday", "2026-11-20"],
    ["by next Monday", "2026-11-16"],
    ["Friday next week", "2026-11-20"],
  ]));

test("end of week / month", () =>
  check([
    ["end of week", "2026-11-13"],
    ["by the end of the week", "2026-11-13"],
    ["end of next week", "2026-11-20"],
    ["end of month", "2026-11-30"],
    ["by the end of the month", "2026-11-30"],
  ]));

test("explicit dates take the year from the meeting date (next occurrence if already passed)", () =>
  check([
    ["2026-12-01", "2026-12-01"],
    ["December 3", "2026-12-03"],
    ["3 December", "2026-12-03"],
    ["3rd of December 2027", "2027-12-03"],
    ["March 12th", "2027-03-12"],
    ["12 March", "2027-03-12"],
    ["May 12", "2027-05-12"],
    ["the 14th", "2026-11-14"],
    ["the 5th", "2026-12-05"],
  ]));

test("unresolvable phrases → null, never a guess", () =>
  check([
    ["soon", null],
    ["ASAP", null],
    ["Q1", null],
    ["next sprint", null],
    ["February 30", null],
    ["in many days", null],
    ["", null],
  ]));

test("no or invalid meeting date → null", () => {
  assert.equal(resolveDueDate("Friday", undefined), null);
  assert.equal(resolveDueDate("Friday", null), null);
  assert.equal(resolveDueDate("2026-12-01", undefined), null);
  assert.equal(resolveDueDate("Friday", "2026-02-30"), null);
  assert.equal(resolveDueDate(null, WED), null);
});

test("month and year boundaries", () => {
  assert.equal(resolveDueDate("next Friday", "2026-12-30"), "2027-01-08");
  assert.equal(resolveDueDate("end of month", "2026-12-30"), "2026-12-31");
  assert.equal(resolveDueDate("January 5", "2026-12-30"), "2027-01-05");
  assert.equal(resolveDueDate("in 3 days", "2026-12-30"), "2027-01-02");
  assert.equal(resolveDueDate("end of month", "2028-02-27"), "2028-02-29");
  assert.equal(resolveDueDate("Monday", "2026-11-09"), "2026-11-09", "a Monday meeting: 'Monday' is the same day");
  assert.equal(resolveDueDate("next Monday", "2026-11-15"), "2026-11-16", "Sunday meeting: next week starts the next day");
});
