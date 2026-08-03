import { readFile } from "fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./helpers/harness.js";

const WRITE_TOOLS = [
  "create_project_dir",
  "create_project_file",
  "delete_project_file",
  "edit_project_file",
  "write_project_file",
];

describe("Server policy", () => {
  let harness: Harness;

  afterEach(async () => {
    await harness?.close();
  });

  describe("by default", () => {
    it("should advertise the read and write tool set", async () => {
      harness = await createHarness();

      const tools = await harness.listTools();

      expect(tools).toEqual(
        expect.arrayContaining([...WRITE_TOOLS, "read_project_file", "list_projects"])
      );
    });
  });

  describe("when read-only mode is enabled", () => {
    it("should not advertise any write tool", async () => {
      harness = await createHarness({ env: { WORKSPACE_READONLY: "true" } });

      const tools = await harness.listTools();

      for (const tool of WRITE_TOOLS) expect(tools).not.toContain(tool);
      expect(tools).toContain("read_project_file");
    });
  });

  describe("when sensitive-file protection is enabled", () => {
    it("should refuse to overwrite a protected file", async () => {
      harness = await createHarness({
        env: { WORKSPACE_PROTECT_SENSITIVE: "true" },
      });
      const secrets = harness.inProject("proj-alpha", ".env");
      await harness.writeFixture(secrets, "TOKEN=original");

      const { text, isError } = await harness.call("write_project_file", {
        path: secrets,
        content: "TOKEN=hijacked",
      });

      expect(isError).toBe(true);
      expect(text).toContain("protected_path");
      await expect(readFile(secrets, "utf-8")).resolves.toBe("TOKEN=original");
    });

    it("should protect nested git internals too", async () => {
      harness = await createHarness({
        env: { WORKSPACE_PROTECT_SENSITIVE: "true" },
      });

      const { text, isError } = await harness.call("write_project_file", {
        path: harness.inProject("proj-alpha", "sub/.git/config"),
        content: "[remote]",
      });

      expect(isError).toBe(true);
      expect(text).toContain("protected_path");
    });

    it("should still allow ordinary files", async () => {
      harness = await createHarness({
        env: { WORKSPACE_PROTECT_SENSITIVE: "true" },
      });

      const { isError } = await harness.call("write_project_file", {
        path: harness.inProject("proj-alpha", "src/index.ts"),
        content: "export {};",
      });

      expect(isError).toBe(false);
    });
  });

  describe("when the base directory matches no projects", () => {
    it("should explain the discovery settings rather than just saying none found", async () => {
      harness = await createHarness({
        projects: [],
        outsideDirs: ["unrelated"],
      });

      const { text } = await harness.call("list_projects");

      expect(text).toContain("No accessible projects found");
      expect(text).toContain("pattern=proj-*");
      expect(text).toContain("dirs_scanned=1");
    });
  });

  describe("when a project is cloned after startup", () => {
    it("should become visible after refreshing", async () => {
      harness = await createHarness({ projects: ["proj-alpha"] });
      await harness.writeFixture(
        harness.inProject("proj-beta", "package.json"),
        '{"name":"beta"}'
      );

      const refreshed = await harness.call("refresh_projects");

      expect(refreshed.text).toContain("proj-beta");
      const listed = await harness.call("list_projects");
      expect(listed.text).toContain("proj-beta");
    });
  });
});
