import { chmod, mkdir, rename, stat, unlink, writeFile } from "fs/promises";
import { basename, dirname, join } from "path";

const BINARY_SNIFF_BYTES = 8192;

/**
 * A NUL byte in the leading bytes is the same heuristic git uses. Decoding a
 * binary file as UTF-8 never throws, it just yields replacement characters, so
 * an explicit check is the only way to keep them out of results.
 */
export function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

export function formatBytes(bytes: number): string {
  const KB = 1024;
  const MB = KB * KB;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)}MB`;
  if (bytes >= KB) return `${(bytes / KB).toFixed(1)}KB`;
  return `${bytes}b`;
}

export async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes via a sibling temp file then renames, so a crash mid-write cannot
 * leave the target truncated. Rename is atomic only within one filesystem,
 * hence the temp file lives in the target's own directory.
 */
export async function writeFileAtomic(target: string, content: string): Promise<void> {
  const directory = dirname(target);
  await mkdir(directory, { recursive: true });

  const tempPath = join(
    directory,
    `.${basename(target)}.${process.pid}.${Date.now()}.tmp`
  );

  const previousMode = await stat(target)
    .then((info) => info.mode)
    .catch(() => undefined);

  try {
    await writeFile(tempPath, content, "utf-8");
    if (previousMode !== undefined) await chmod(tempPath, previousMode);
    await rename(tempPath, target);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}
