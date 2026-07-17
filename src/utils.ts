import { createHash } from "node:crypto";

export const SHANGHAI_TIMEZONE = "Asia/Shanghai";

export function dateInShanghai(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function isoFromUnix(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

export function stableId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function isWithinHours(unixSeconds: number, hours: number, now = Date.now()): boolean {
  if (!unixSeconds) return false;
  const age = now - unixSeconds * 1000;
  return age >= -3_600_000 && age <= hours * 3_600_000;
}

