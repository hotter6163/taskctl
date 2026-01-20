import { ulid } from "ulid";

/**
 * Generate a new ULID
 * ULIDs are Universally Unique Lexicographically Sortable Identifiers
 * - 128-bit compatible with UUID
 * - Lexicographically sortable
 * - URL safe
 */
export function generateId(): string {
  return ulid();
}

/**
 * Generate a short ID (first 8 characters of ULID)
 * Used for branch names and display purposes
 */
export function generateShortId(): string {
  return ulid().substring(0, 8);
}

/**
 * Get a short version of an existing ID
 */
export function shortId(id: string): string {
  return id.substring(0, 8);
}

/**
 * Get current ISO8601 timestamp
 */
export function now(): string {
  return new Date().toISOString();
}
