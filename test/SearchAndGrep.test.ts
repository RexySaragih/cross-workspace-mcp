import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./helpers/harness.js";

describe("Search and grep", () => {
  let harness: Harness;

  afterEach(async () => {
    await harness?.close();
  });

  describe("when searching by filename across projects", () => {
    it("should find matches in every project", async () => {
      harness = await createHarness({ projects: ["proj-alpha", "proj-beta"] });
      await harness.writeFixture(
        harness.inProject("proj-alpha", "src/auth-service.ts"),
        ""
      );
      await harness.writeFixture(
        harness.inProject("proj-beta", "lib/auth-guard.ts"),
        ""
      );

      const { text } = await harness.call("search_project_files", {
        pattern: "auth",
      });

      expect(text).toContain("auth-service.ts");
      expect(text).toContain("auth-guard.ts");
    });

    it("should scope results when a project is named", async () => {
      harness = await createHarness({ projects: ["proj-alpha", "proj-beta"] });
      await harness.writeFixture(harness.inProject("proj-alpha", "auth.ts"), "");
      await harness.writeFixture(harness.inProject("proj-beta", "auth.ts"), "");

      const { text } = await harness.call("search_project_files", {
        pattern: "auth",
        project: "proj-beta",
      });

      expect(text).toContain("proj-beta");
      expect(text).not.toContain("proj-alpha");
    });

    it("should list the available projects when the name matches nothing", async () => {
      harness = await createHarness({ projects: ["proj-alpha"] });

      const { text, isError } = await harness.call("search_project_files", {
        pattern: "auth",
        project: "does-not-exist",
      });

      expect(isError).toBe(true);
      expect(text).toContain("proj-alpha");
    });
  });

  describe("when searching inside ignored directories", () => {
    it("should skip them", async () => {
      harness = await createHarness();
      await harness.writeFixture(
        harness.inProject("proj-alpha", "node_modules/pkg/auth.ts"),
        ""
      );

      const { text } = await harness.call("search_project_files", {
        pattern: "auth",
      });

      expect(text).toContain("No files matching");
    });
  });

  describe("when grepping file contents", () => {
    it("should report the file and line number of each match", async () => {
      harness = await createHarness();
      await harness.writeFixture(
        harness.inProject("proj-alpha", "src/user.ts"),
        "const a = 1;\nexport class UserService {}"
      );

      const { text } = await harness.call("grep_project_content", {
        query: "UserService",
      });

      expect(text).toContain("user.ts:2");
      expect(text).toContain("export class UserService {}");
    });

    it("should skip binary files instead of emitting garbage", async () => {
      harness = await createHarness();
      await harness.writeFixture(
        harness.inProject("proj-alpha", "asset.ts"),
        Buffer.from([0x00, 0x4e, 0x45, 0x45, 0x44, 0x4c, 0x45])
      );

      const { text } = await harness.call("grep_project_content", {
        query: "NEEDLE",
        extensions: "*",
      });

      expect(text).toContain("No matches found");
    });

    it("should ignore files outside the default extension list", async () => {
      harness = await createHarness();
      await harness.writeFixture(
        harness.inProject("proj-alpha", "archive.zzz"),
        "NEEDLE lives here"
      );

      const scoped = await harness.call("grep_project_content", { query: "NEEDLE" });
      const widened = await harness.call("grep_project_content", {
        query: "NEEDLE",
        extensions: "*",
      });

      expect(scoped.text).toContain("No matches found");
      expect(widened.text).toContain("archive.zzz");
    });

    it("should treat an unparseable regex as literal text rather than failing", async () => {
      harness = await createHarness();
      await harness.writeFixture(
        harness.inProject("proj-alpha", "notes.md"),
        "call calculateTotal( to begin"
      );

      const { text, isError } = await harness.call("grep_project_content", {
        query: "calculateTotal(",
      });

      expect(isError).toBe(false);
      expect(text).toContain("notes.md");
    });

    it("should honour gitignore when that feature is enabled", async () => {
      harness = await createHarness({
        env: { WORKSPACE_RESPECT_GITIGNORE: "true" },
      });
      await harness.writeFixture(
        harness.inProject("proj-alpha", ".gitignore"),
        "generated/\n"
      );
      await harness.writeFixture(
        harness.inProject("proj-alpha", "generated/out.ts"),
        "const NEEDLE = 1;"
      );

      const { text } = await harness.call("grep_project_content", { query: "NEEDLE" });

      expect(text).toContain("No matches found");
    });
  });
});
