import { describe, it, expect } from "vitest";
import {
  sortKeysRecursive,
  normalizedJsonHash,
  computeClientHash,
} from "../hash.js";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("hash utilities", () => {
  describe("normalizedJsonHash", () => {
    it("produces same hash for different key order", () => {
      const a = { a: 1, b: 2 };
      const b = { b: 2, a: 1 };
      expect(normalizedJsonHash(a)).toBe(normalizedJsonHash(b));
    });

    it("differs for different content", () => {
      const a = { a: 1 };
      const b = { a: 2 };
      expect(normalizedJsonHash(a)).not.toBe(normalizedJsonHash(b));
    });

    it("handles nested objects with different key order", () => {
      const a = { x: { b: 2, a: 1 } };
      const b = { x: { a: 1, b: 2 } };
      expect(normalizedJsonHash(a)).toBe(normalizedJsonHash(b));
    });

    it("produces same hash for arrays with same content", () => {
      const a = [1, 2, 3];
      const b = [1, 2, 3];
      expect(normalizedJsonHash(a)).toBe(normalizedJsonHash(b));
    });
  });

  describe("computeClientHash", () => {
    it("is deterministic", () => {
      const dir = mkdtempSync(join(tmpdir(), "hash-test-"));
      try {
        const typesDir = join(dir, "types");
        const contextsDir = join(dir, "contexts");
        mkdirSync(typesDir, { recursive: true });
        mkdirSync(contextsDir, { recursive: true });
        writeFileSync(join(typesDir, "index.ts"), "export interface X {}");
        writeFileSync(join(dir, "client.ts"), "export const client = {}");
        writeFileSync(join(dir, "apiClient.ts"), "export const api = {}");
        writeFileSync(join(dir, "index.ts"), "export * from './client'");
        writeFileSync(join(contextsDir, "items.ts"), "export const items = {}");

        const hash1 = computeClientHash(dir, ".");
        const hash2 = computeClientHash(dir, ".");
        expect(hash1).toBe(hash2);
      } finally {
        // cleanup handled by tmp
      }
    });

    it("changes when file content changes", () => {
      const dir = mkdtempSync(join(tmpdir(), "hash-test-"));
      try {
        const typesDir = join(dir, "types");
        const contextsDir = join(dir, "contexts");
        mkdirSync(typesDir, { recursive: true });
        mkdirSync(contextsDir, { recursive: true });
        writeFileSync(join(typesDir, "index.ts"), "export interface X {}");
        writeFileSync(join(dir, "client.ts"), "export const client = {}");
        writeFileSync(join(dir, "apiClient.ts"), "export const api = {}");
        writeFileSync(join(dir, "index.ts"), "export * from './client'");
        writeFileSync(join(contextsDir, "items.ts"), "export const items = {}");

        const hash1 = computeClientHash(dir, ".");

        writeFileSync(
          join(contextsDir, "items.ts"),
          "export const items = {}; // modified",
        );
        const hash2 = computeClientHash(dir, ".");

        expect(hash1).not.toBe(hash2);
      } finally {
        // cleanup handled by tmp
      }
    });
  });
});
