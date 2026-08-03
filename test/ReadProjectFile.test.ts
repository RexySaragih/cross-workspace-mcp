import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./helpers/harness.js";

const SAMPLE = ["one", "two", "three", "four", "five"].join("\n");

describe("Read project file", () => {
  let harness: Harness;

  afterEach(async () => {
    await harness?.close();
  });

  describe("when no range is given", () => {
    it("should return the whole file with a line count header", async () => {
      harness = await createHarness();
      const file = harness.inProject("proj-alpha", "notes.txt");
      await harness.writeFixture(file, SAMPLE);

      const { text, isError } = await harness.call("read_project_file", { path: file });

      expect(isError).toBe(false);
      expect(text).toContain("5L");
      expect(text).toContain("three");
    });
  });

  describe("when an offset and limit are given", () => {
    it("should return only that numbered range", async () => {
      harness = await createHarness();
      const file = harness.inProject("proj-alpha", "notes.txt");
      await harness.writeFixture(file, SAMPLE);

      const { text } = await harness.call("read_project_file", {
        path: file,
        offset: 2,
        limit: 2,
      });

      expect(text).toContain("L2-3/5");
      expect(text).toContain("2|two");
      expect(text).toContain("3|three");
      expect(text).not.toContain("1|one");
      expect(text).not.toContain("4|four");
    });
  });

  describe("when the offset is past the end of the file", () => {
    it("should report that rather than returning an empty range", async () => {
      harness = await createHarness();
      const file = harness.inProject("proj-alpha", "notes.txt");
      await harness.writeFixture(file, SAMPLE);

      const { text, isError } = await harness.call("read_project_file", {
        path: file,
        offset: 99,
      });

      expect(isError).toBe(true);
      expect(text).toContain("beyond end of file");
    });
  });

  describe("when the file exceeds the read limit", () => {
    it("should refuse instead of loading it into the response", async () => {
      harness = await createHarness({ env: { WORKSPACE_MAX_READ_BYTES: "64" } });
      const file = harness.inProject("proj-alpha", "big.txt");
      await harness.writeFixture(file, "x".repeat(500));

      const { text, isError } = await harness.call("read_project_file", { path: file });

      expect(isError).toBe(true);
      expect(text).toContain("too large");
    });
  });

  describe("when the file is binary", () => {
    it("should refuse rather than emitting replacement characters", async () => {
      harness = await createHarness();
      const file = harness.inProject("proj-alpha", "logo.png");
      await harness.writeFixture(file, Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02]));

      const { text, isError } = await harness.call("read_project_file", { path: file });

      expect(isError).toBe(true);
      expect(text).toContain("looks binary");
    });
  });

  describe("when reading several files at once", () => {
    it("should label each file and skip oversized ones individually", async () => {
      harness = await createHarness({
        env: { WORKSPACE_MAX_BATCH_READ_BYTES: "32" },
      });
      const small = harness.inProject("proj-alpha", "small.txt");
      const large = harness.inProject("proj-alpha", "large.txt");
      await harness.writeFixture(small, "tiny");
      await harness.writeFixture(large, "y".repeat(200));

      const { text } = await harness.call("read_project_files", {
        paths: [small, large],
      });

      expect(text).toContain("tiny");
      expect(text).toContain("SKIPPED too large");
      expect(text).not.toContain("yyyyyyyy");
    });
  });
});
