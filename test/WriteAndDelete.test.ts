import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./helpers/harness.js";

describe("Write, create and delete", () => {
  let harness: Harness;

  afterEach(async () => {
    await harness?.close();
  });

  describe("when writing a file whose parent does not exist", () => {
    it("should create the parent directories", async () => {
      harness = await createHarness();
      const file = harness.inProject("proj-alpha", "deep/nested/config.json");

      const { text, isError } = await harness.call("write_project_file", {
        path: file,
        content: "{}",
      });

      expect(isError).toBe(false);
      expect(text).toContain("created");
      await expect(readFile(file, "utf-8")).resolves.toBe("{}");
    });
  });

  describe("when overwriting an existing file", () => {
    it("should report it as updated and preserve the file mode", async () => {
      harness = await createHarness();
      const file = harness.inProject("proj-alpha", "run.sh");
      await harness.writeFixture(file, "old");
      const modeBefore = (await stat(file)).mode;

      const { text } = await harness.call("write_project_file", {
        path: file,
        content: "new",
      });

      expect(text).toContain("updated");
      await expect(readFile(file, "utf-8")).resolves.toBe("new");
      expect((await stat(file)).mode).toBe(modeBefore);
    });

    it("should leave no temp files behind", async () => {
      harness = await createHarness();
      const file = harness.inProject("proj-alpha", "data.txt");
      await harness.writeFixture(file, "old");

      await harness.call("write_project_file", { path: file, content: "new" });

      const entries = await readdir(harness.inProject("proj-alpha"));
      expect(entries).toEqual(["data.txt"]);
    });
  });

  describe("when create_only is set and the file exists", () => {
    it("should fail without touching the original", async () => {
      harness = await createHarness();
      const file = harness.inProject("proj-alpha", "once.txt");
      await harness.writeFixture(file, "original");

      const { text, isError } = await harness.call("write_project_file", {
        path: file,
        content: "replacement",
        create_only: true,
      });

      expect(isError).toBe(true);
      expect(text).toContain("already exists");
      await expect(readFile(file, "utf-8")).resolves.toBe("original");
    });
  });

  describe("when creating a file that already exists", () => {
    it("should fail the same way as write with create_only", async () => {
      harness = await createHarness();
      const file = harness.inProject("proj-alpha", "once.txt");
      await harness.writeFixture(file, "original");

      const { text, isError } = await harness.call("create_project_file", {
        path: file,
        content: "replacement",
      });

      expect(isError).toBe(true);
      expect(text).toContain("already exists");
    });
  });

  describe("when creating a directory", () => {
    it("should fail if it already exists", async () => {
      harness = await createHarness();
      const dir = harness.inProject("proj-alpha", "modules");
      await harness.call("create_project_dir", { path: dir });

      const { text, isError } = await harness.call("create_project_dir", { path: dir });

      expect(isError).toBe(true);
      expect(text).toContain("already exists");
    });

    it("should fail when parents are missing and parents is false", async () => {
      harness = await createHarness();

      const { isError } = await harness.call("create_project_dir", {
        path: harness.inProject("proj-alpha", "a/b/c"),
        parents: false,
      });

      expect(isError).toBe(true);
    });
  });

  describe("when deleting", () => {
    it("should remove a file", async () => {
      harness = await createHarness();
      const file = harness.inProject("proj-alpha", "scratch.txt");
      await harness.writeFixture(file, "temp");

      const { isError } = await harness.call("delete_project_file", { path: file });

      expect(isError).toBe(false);
      await expect(readFile(file, "utf-8")).rejects.toThrow();
    });

    it("should refuse to delete a directory", async () => {
      harness = await createHarness();
      const dir = harness.inProject("proj-alpha", "src");
      await harness.call("create_project_dir", { path: dir });

      const { text, isError } = await harness.call("delete_project_file", {
        path: dir,
      });

      expect(isError).toBe(true);
      expect(text).toContain("is a directory");
    });

    it("should move the file to trash when soft delete is enabled", async () => {
      harness = await createHarness({ env: { WORKSPACE_SOFT_DELETE: "true" } });
      const file = harness.inProject("proj-alpha", "scratch.txt");
      await harness.writeFixture(file, "recoverable");

      const { text } = await harness.call("delete_project_file", { path: file });

      expect(text).toContain("moved to trash");
      const trash = await readdir(
        join(harness.inProject("proj-alpha"), ".workspace-trash")
      );
      expect(trash).toHaveLength(1);
    });
  });
});
