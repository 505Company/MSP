export interface ArchiveEntryInfo {
  name: string;
  compressedBytes: number;
  uncompressedBytes: number;
}

export interface ArchiveInspection {
  entries: number;
  compressedBytes: number;
  uncompressedBytes: number;
  compressionRatio: number;
}

export const ARCHIVE_LIMITS = Object.freeze({
  maxEntries: 20_000,
  maxUncompressedBytes: 400 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxNameLength: 1_024,
});

export function inspectArchiveIndex(entries: readonly ArchiveEntryInfo[]): ArchiveInspection {
  if (entries.length > ARCHIVE_LIMITS.maxEntries) throw new Error("archive entry budget exceeded");
  let compressedBytes = 0;
  let uncompressedBytes = 0;

  for (const entry of entries) {
    if (!safeInteger(entry.compressedBytes) || !safeInteger(entry.uncompressedBytes)) {
      throw new Error("invalid archive size metadata");
    }
    if (!safeArchiveName(entry.name)) throw new Error("unsafe archive entry name");
    compressedBytes += entry.compressedBytes;
    uncompressedBytes += entry.uncompressedBytes;
    if (!Number.isSafeInteger(compressedBytes) || !Number.isSafeInteger(uncompressedBytes)) {
      throw new Error("archive size overflow");
    }
    if (uncompressedBytes > ARCHIVE_LIMITS.maxUncompressedBytes) {
      throw new Error("uncompressed archive budget exceeded");
    }
  }

  const compressionRatio = uncompressedBytes / Math.max(1, compressedBytes);
  if (compressionRatio > ARCHIVE_LIMITS.maxCompressionRatio) {
    throw new Error("archive compression ratio exceeded");
  }
  return { entries: entries.length, compressedBytes, uncompressedBytes, compressionRatio };
}

function safeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function safeArchiveName(name: string): boolean {
  if (typeof name !== "string" || name.length < 1 || name.length > ARCHIVE_LIMITS.maxNameLength) return false;
  const normalized = name.replaceAll("\\", "/");
  return !normalized.startsWith("/") && !normalized.split("/").includes("..");
}
