import assert from "node:assert/strict";
import test from "node:test";
import { dateInShanghai, isWithinHours, stableId } from "../src/utils.js";

test("dateInShanghai observes China Standard Time", () => {
  assert.equal(dateInShanghai(new Date("2026-07-16T16:30:00Z")), "2026-07-17");
});

test("isWithinHours rejects stale articles", () => {
  const now = Date.parse("2026-07-17T02:00:00Z");
  assert.equal(isWithinHours(Date.parse("2026-07-16T10:00:00Z") / 1000, 24, now), true);
  assert.equal(isWithinHours(Date.parse("2026-07-15T10:00:00Z") / 1000, 24, now), false);
});

test("stableId is deterministic", () => {
  assert.equal(stableId("https://example.com/a"), stableId("https://example.com/a"));
});

