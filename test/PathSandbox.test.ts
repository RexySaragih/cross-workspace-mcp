import { readFile } from "fs/promises";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./helpers/harness.js";

describe("Path sandbox", () => {
  let harness: Harness;

  afterEach(async () => {
    await harness?.close();
  });

  describe("when a path resolves inside an allowed project", () => {
    it("should allow the read", async () => {
      harness = await createHarness({ projects: ["proj-alpha"] });
      const file = harness.inProject("proj-alpha", "src/app.ts");
      await harness.writeFixture(file, "export const answer = 42;");

      const result = await harness.call("read_project_file", { path: file });

      expect(result.isError).toBe(false);
      expect(result.text).toContain("export const answer = 42;");
    });
  });

  describe("when a symlink inside a project points outside every root", () => {
    it("should refuse to read through it", async () => {
      harness = await createHarness({
        projects: ["proj-alpha"],
        outsideDirs: ["vault"],
      });
      const secret = join(harness.baseDir, "vault", "secret.txt");
      await harness.writeFixture(secret, "TOP SECRET");

      const escape = harness.inProject("proj-alpha", "src/escape");
      await harness.linkFixture(escape, join(harness.baseDir, "vault"));

      const result = await harness.call("read_project_file", {
        path: join(escape, "secret.txt"),
      });

      expect(result.isError).toBe(true);
      expect(result.text).toContain("outside_roots");
      expect(result.text).not.toContain("TOP SECRET");
    });

    it("should refuse to write through it", async () => {
      harness = await createHarness({
        projects: ["proj-alpha"],
        outsideDirs: ["vault"],
      });
      const escape = harness.inProject("proj-alpha", "escape");
      await harness.linkFixture(escape, join(harness.baseDir, "vault"));

      const result = await harness.call("write_project_file", {
        path: join(escape, "planted.txt"),
        content: "should never land",
      });

      expect(result.isError).toBe(true);
      expect(result.text).toContain("outside_roots");
      await expect(
        readFile(join(harness.baseDir, "vault", "planted.txt"), "utf-8")
      ).rejects.toThrow();
    });

    it("should refuse to delete through it", async () => {
      harness = await createHarness({
        projects: ["proj-alpha"],
        outsideDirs: ["vault"],
      });
      const victim = join(harness.baseDir, "vault", "keep.txt");
      await harness.writeFixture(victim, "still here");

      const escape = harness.inProject("proj-alpha", "escape");
      await harness.linkFixture(escape, join(harness.baseDir, "vault"));

      const result = await harness.call("delete_project_file", {
        path: join(escape, "keep.txt"),
      });

      expect(result.isError).toBe(true);
      await expect(readFile(victim, "utf-8")).resolves.toBe("still here");
    });

    it("should not surface files reached through it in grep results", async () => {
      harness = await createHarness({
        projects: ["proj-alpha"],
        outsideDirs: ["vault"],
      });
      await harness.writeFixture(
        join(harness.baseDir, "vault", "creds.ts"),
        "const NEEDLE_TOKEN = 'abc';"
      );
      await harness.linkFixture(
        harness.inProject("proj-alpha", "escape"),
        join(harness.baseDir, "vault")
      );

      const result = await harness.call("grep_project_content", {
        query: "NEEDLE_TOKEN",
      });

      expect(result.text).toContain("No matches found");
    });
  });

  describe("when a sibling directory merely shares a root's name prefix", () => {
    it("should deny it because it is not itself a root", async () => {
      harness = await createHarness({
        projects: ["proj-alpha"],
        outsideDirs: ["proj-alpha-secrets"],
        env: { WORKSPACE_PATTERN: "proj-alpha" },
      });
      const sibling = join(harness.baseDir, "proj-alpha-secrets", "leak.txt");
      await harness.writeFixture(sibling, "LEAKED");

      const result = await harness.call("read_project_file", { path: sibling });

      expect(result.isError).toBe(true);
      expect(result.text).toContain("outside_roots");
      expect(result.text).not.toContain("LEAKED");
    });
  });

  describe("when the path escapes with parent-directory segments", () => {
    it("should deny it", async () => {
      harness = await createHarness({
        projects: ["proj-alpha"],
        outsideDirs: ["vault"],
      });
      await harness.writeFixture(
        join(harness.baseDir, "vault", "secret.txt"),
        "TOP SECRET"
      );

      const result = await harness.call("read_project_file", {
        path: harness.inProject("proj-alpha", "../vault/secret.txt"),
      });

      expect(result.isError).toBe(true);
      expect(result.text).not.toContain("TOP SECRET");
    });
  });

  describe("when the path is relative", () => {
    it("should deny it rather than resolving against the server's cwd", async () => {
      harness = await createHarness({ projects: ["proj-alpha"] });

      const result = await harness.call("read_project_file", {
        path: "proj-alpha/src/app.ts",
      });

      expect(result.isError).toBe(true);
      expect(result.text).toContain("not_absolute");
    });
  });
});
