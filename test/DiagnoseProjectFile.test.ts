import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./helpers/harness.js";

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, target: "ES2022", noEmit: true },
});

describe("Diagnose project file", () => {
  let harness: Harness;

  afterEach(async () => {
    await harness?.close();
  });

  describe("when the file type checks cleanly", () => {
    it("should report zero issues as a success", async () => {
      harness = await createHarness();
      const file = harness.inProject("proj-alpha", "ok.ts");
      await harness.writeFixture(
        harness.inProject("proj-alpha", "tsconfig.json"),
        TSCONFIG
      );
      await harness.writeFixture(file, "export const total: number = 1;\n");

      const { text, isError } = await harness.call("diagnose_project_file", {
        path: file,
      });

      expect(isError).toBe(false);
      expect(text).toContain("0 issues");
    });
  });

  describe("when the file has a type error", () => {
    it("should report the error as a successful diagnosis, not a tool failure", async () => {
      harness = await createHarness();
      const file = harness.inProject("proj-alpha", "bad.ts");
      await harness.writeFixture(
        harness.inProject("proj-alpha", "tsconfig.json"),
        TSCONFIG
      );
      await harness.writeFixture(file, "export const total: number = 'nope';\n");

      const { text, isError } = await harness.call("diagnose_project_file", {
        path: file,
      });

      expect(isError).toBe(false);
      expect(text).toContain("1 error(s)");
      expect(text).toContain("TS2322");
    });
  });

  describe("when the file changes between two diagnose calls", () => {
    it("should reflect the new content rather than a cached program", async () => {
      harness = await createHarness();
      const file = harness.inProject("proj-alpha", "evolving.ts");
      await harness.writeFixture(
        harness.inProject("proj-alpha", "tsconfig.json"),
        TSCONFIG
      );
      await harness.writeFixture(file, "export const total: number = 'nope';\n");

      const before = await harness.call("diagnose_project_file", { path: file });
      expect(before.text).toContain("TS2322");

      await harness.writeFixture(file, "export const total: number = 7;\n");
      const after = await harness.call("diagnose_project_file", { path: file });

      expect(after.text).toContain("0 issues");
    });
  });

  describe("when the extension is not a TypeScript or JavaScript file", () => {
    it("should refuse", async () => {
      harness = await createHarness();
      const file = harness.inProject("proj-alpha", "readme.md");
      await harness.writeFixture(file, "# hi");

      const { text, isError } = await harness.call("diagnose_project_file", {
        path: file,
      });

      expect(isError).toBe(true);
      expect(text).toContain("unsupported type");
    });
  });

  describe("when the file does not exist", () => {
    it("should say so", async () => {
      harness = await createHarness();

      const { text, isError } = await harness.call("diagnose_project_file", {
        path: harness.inProject("proj-alpha", "missing.ts"),
      });

      expect(isError).toBe(true);
      expect(text).toContain("does not exist");
    });
  });
});
