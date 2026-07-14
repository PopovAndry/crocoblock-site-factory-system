"use strict";

const fs = require("fs");
const crypto = require("crypto");
const zlib = require("zlib");

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH = 65557;
const MAX_ENTRIES = 25000;
const MAX_UNCOMPRESSED_TOTAL = 512 * 1024 * 1024;
const MAX_SINGLE_ENTRY = 128 * 1024 * 1024;

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const content = fs.readFileSync(filePath);
  hash.update(content);
  return hash.digest("hex");
}

function findEndOfCentralDirectory(buffer) {
  const start = Math.max(0, buffer.length - MAX_EOCD_SEARCH);
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  return -1;
}

function normalizeZipName(rawName) {
  const name = String(rawName || "").replace(/\\/g, "/");
  if (!name || name.includes("\0")) {
    throw new Error("ZIP contains an empty or invalid entry name.");
  }
  if (name.startsWith("/") || /^[A-Za-z]:\//.test(name) || name.startsWith("//")) {
    throw new Error("ZIP contains an absolute entry path.");
  }
  const parts = name.split("/");
  if (parts.some((part) => part === "..")) {
    throw new Error("ZIP contains a path traversal entry.");
  }
  return name;
}

function isDirectoryEntry(name, externalAttributes) {
  const unixMode = (externalAttributes >>> 16) & 0xffff;
  return name.endsWith("/") || (unixMode & 0o170000) === 0o040000;
}

function isSymlinkEntry(externalAttributes) {
  const unixMode = (externalAttributes >>> 16) & 0xffff;
  return (unixMode & 0o170000) === 0o120000;
}

function parseCentralDirectory(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset === -1) {
    throw new Error("Invalid ZIP: central directory not found.");
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (entryCount > MAX_ENTRIES) {
    throw new Error("ZIP contains too many entries.");
  }
  if (centralDirectoryOffset + centralDirectorySize > buffer.length) {
    throw new Error("Invalid ZIP: central directory is outside file bounds.");
  }

  const entries = [];
  let totalUncompressedSize = 0;
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("Invalid ZIP: malformed central directory entry.");
    }

    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const rawName = buffer.slice(offset + 46, offset + 46 + nameLength).toString("utf8");
    const name = normalizeZipName(rawName);

    if ((flags & 0x1) === 0x1) {
      throw new Error("ZIP contains encrypted entries.");
    }
    if (![0, 8].includes(method)) {
      throw new Error("ZIP uses an unsupported compression method.");
    }
    if (isSymlinkEntry(externalAttributes)) {
      throw new Error("ZIP contains symbolic links.");
    }
    if (uncompressedSize > MAX_SINGLE_ENTRY) {
      throw new Error("ZIP contains an entry that is too large.");
    }

    totalUncompressedSize += uncompressedSize;
    if (totalUncompressedSize > MAX_UNCOMPRESSED_TOTAL) {
      throw new Error("ZIP uncompressed size is too large.");
    }

    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      externalAttributes,
      directory: isDirectoryEntry(name, externalAttributes)
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return {
    entries,
    total_uncompressed_size: totalUncompressedSize
  };
}

function readZipEntry(buffer, entry) {
  const offset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(offset) !== LOCAL_FILE_SIGNATURE) {
    throw new Error("Invalid ZIP: malformed local file header.");
  }

  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedSize;
  if (dataEnd > buffer.length) {
    throw new Error("Invalid ZIP: entry data is outside file bounds.");
  }

  const compressed = buffer.slice(dataOffset, dataEnd);
  if (entry.method === 0) {
    return compressed;
  }
  if (entry.method === 8) {
    return zlib.inflateRawSync(compressed);
  }
  throw new Error("ZIP uses an unsupported compression method.");
}

function parseHeaderValue(content, headerName) {
  const escapedHeaderName = headerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp("^\\s*(?:\\*\\s*)?" + escapedHeaderName + "\\s*:\\s*(.+?)\\s*$", "im");
  const match = String(content || "").match(pattern);
  return match ? match[1].trim() : null;
}

function validateZipPackage(zipPath, dependency) {
  const resolvedZipPath = String(zipPath || "");
  const stat = fs.statSync(resolvedZipPath);
  if (!stat.isFile()) {
    throw new Error("Package source is not a file.");
  }

  const buffer = fs.readFileSync(resolvedZipPath);
  const digest = crypto.createHash("sha256").update(buffer).digest("hex");
  const parsed = parseCentralDirectory(buffer);
  const entries = parsed.entries;
  const normalizedIdentityPath = String(dependency.identity_file || "").replace(/\\/g, "/");
  const identityEntry = entries.find((entry) => entry.name === normalizedIdentityPath && !entry.directory);
  const rootPrefix = String(dependency.zip_root || dependency.wp_slug || dependency.slug) + "/";
  const rootEntries = entries.filter((entry) => entry.name === rootPrefix || entry.name.startsWith(rootPrefix));

  if (!rootEntries.length) {
    throw new Error("Package ZIP does not contain the expected product root.");
  }
  if (!identityEntry) {
    throw new Error("Package ZIP does not contain the expected product identity file.");
  }

  const identityContent = readZipEntry(buffer, identityEntry).toString("utf8");
  const version = parseHeaderValue(identityContent, dependency.version_header || "Version");
  if (!version) {
    throw new Error("Package identity file is missing a Version header.");
  }

  return {
    valid: true,
    sha256: digest,
    byte_size: stat.size,
    entry_count: entries.length,
    total_uncompressed_size: parsed.total_uncompressed_size,
    product: {
      slug: dependency.slug,
      type: dependency.type,
      wp_slug: dependency.wp_slug,
      zip_root: dependency.zip_root,
      identity_file: dependency.identity_file,
      version
    }
  };
}

module.exports = {
  parseCentralDirectory,
  sha256File,
  validateZipPackage
};
