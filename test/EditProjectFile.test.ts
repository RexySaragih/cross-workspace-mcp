import { readFile } from "fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./helpers/harness.js";

describe("Edit project file", () => {
  let harness: Harness;

  afterEach(async () => {
    await harness?.close();
  });

  describe("when every edit matches exactly once", () => {
    it("should apply them all and report the byte delta", async () => {
      harness = await createHarness();
      const file = harness.inProject("proj-alpha", "service.ts");
      await harness.writeFixture(file, "const role = 'admin';\nconst tier = 'free';");

      const { text, isError } = await harness.call("edit_project_file", {
        path: file,
        edits: [
          { old_string: "'admin'", new_string: "'owner'" },
          { old_string: "'free'", new_string: "'pro'" },
        ],
      });

      expect(isError).toBe(false);
      expect(text).toContain("2 edit(s)");
      await expect(readFile(file, "utf-8")).resolves.toBe(
        "const role = 'owner';\nconst tier = 'pro';"
      );
    });
  });

  describe("when an edit matches more than once without replace_all", () => {
    it("should refuse and leave the file untouched", async () => {
      harness = await createHarness();
      const file = harness.inProject("proj-alpha", "service.ts");
      const original = "let a = 1;\nlet a = 1;";
      await harness.writeFixture(file, original);

      const { text, isError } = await harness.call("edit_project_file", {
        path: file,
        edits: [{ old_string: "let a = 1;", new_string: "let a = 2;" }],
      });

      expect(isError).toBe(true);
      expect(text).toContain("2 matches");
      await expect(readFile(file, "utf-8")).resolves.toBe(original);
    });
  });

  describe("when replace_all is set", () => {
    it("should replace every occurrence", async () => {
      harness = await createHarness();
      const file = harness.inProject("proj-alpha", "service.ts");
      await harness.writeFixture(file, "a\na\na");

      await harness.call("edit_project_file", {
        path: file,
        edits: [{ old_string: "a", new_string: "b", replace_all: true }],
      });

      await expect(readFile(file, "utf-8")).resolves.toBe("b\nb\nb");
    });
  });

  describe("when a later edit in the batch cannot be applied", () => {
    it("should write nothing at all", async () => {
      harness = await createHarness();
      const file = harness.inProject("proj-alpha", "service.ts");
      const original = "keep me";
      await harness.writeFixture(file, original);

      const { text, isError } = await harness.call("edit_project_file", {
        path: file,
        edits: [
          { old_string: "keep", new_string: "kept" },
          { old_string: "does-not-exist", new_string: "x" },
        ],
      });

      expect(isError).toBe(true);
      expect(text).toContain("edit 2/2");
      await expect(readFile(file, "utf-8")).resolves.toBe(original);
    });
  });

  describe("when the edit produces identical content", () => {
    it("should report no changes", async () => {
      harness = await createHarness();
      const file = harness.inProject("proj-alpha", "service.ts");
      await harness.writeFixture(file, "same");

      const { text, isError } = await harness.call("edit_project_file", {
        path: file,
        edits: [{ old_string: "same", new_string: "same" }],
      });

      expect(isError).toBe(false);
      expect(text).toContain("0 edits (no changes)");
    });
  });

  describe("when the file is binary", () => {
    it("should refuse to edit it", async () => {
      harness = await createHarness();
      const file = harness.inProject("proj-alpha", "blob.bin");
      await harness.writeFixture(file, Buffer.from([0x00, 0x01, 0x02]));

      const { text, isError } = await harness.call("edit_project_file", {
        path: file,
        edits: [{ old_string: "\u0001", new_string: "x" }],
      });

      expect(isError).toBe(true);
      expect(text).toContain("looks binary");
    });
  });
});
