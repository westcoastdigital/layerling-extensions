import { promises as fs } from "fs";
import path from "path";
import type { ExtensionListing, ExtensionManifest, ExtensionValues } from "@/lib/extensions/types";

/**
 * Where extensions and their settings live: two folders outside layerling's own tree, so pulling a new
 * layerling never touches them. Read at request time, so adding an extension needs no rebuild.
 */
export const EXTENSIONS_DIR_ENV = "LAYERLING_EXTENSIONS_DIR";
export const EXTENSION_DATA_DIR_ENV = "LAYERLING_EXTENSION_DATA_DIR";
export const EXTENSION_FILES_ROUTE = "/api/extensions/files";

const STATE_FILE = "_extensions.json";
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export function extensionsDir() {
  const dir = process.env[EXTENSIONS_DIR_ENV]?.trim();
  return dir ? path.resolve(dir) : null;
}

export function extensionDataDir() {
  const dir = process.env[EXTENSION_DATA_DIR_ENV]?.trim();
  return dir ? path.resolve(dir) : null;
}

export function validExtensionId(id: unknown): id is string {
  return typeof id === "string" && ID_PATTERN.test(id);
}

/** A path inside root, or null for anything that climbs out of it. */
export function insideFolder(root: string, ...parts: string[]) {
  const resolved = path.resolve(root, ...parts);
  return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temp, file);
}

export async function readHostState(): Promise<{ disabled: string[] }> {
  const dir = extensionDataDir();
  const stored = dir ? await readJson<{ disabled?: unknown }>(path.join(dir, STATE_FILE)) : null;
  const disabled = Array.isArray(stored?.disabled) ? stored.disabled.filter(validExtensionId) : [];
  return { disabled };
}

export async function writeHostState(disabled: string[]) {
  const dir = extensionDataDir();
  if (!dir) throw new Error(`${EXTENSION_DATA_DIR_ENV} is not set`);
  await writeJsonAtomic(path.join(dir, STATE_FILE), { disabled: [...new Set(disabled.filter(validExtensionId))].sort() });
}

export async function listExtensions(): Promise<ExtensionListing[]> {
  const dir = extensionsDir();
  if (!dir) return [];
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const { disabled } = await readHostState();
  const listed: ExtensionListing[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
    const folder = entry.name;
    const baseUrl = `${EXTENSION_FILES_ROUTE}/${encodeURIComponent(folder)}/`;
    const manifest = await readJson<Partial<ExtensionManifest>>(path.join(dir, folder, "extension.json"));
    if (!manifest) {
      listed.push({ id: folder, name: folder, baseUrl, enabled: false, error: "extension.json is missing or not valid JSON" });
      continue;
    }
    // The folder name is the id: two folders can never claim the same one.
    const id = folder;
    if (!validExtensionId(id)) continue;
    listed.push({
      id,
      name: typeof manifest.name === "string" && manifest.name ? manifest.name : id,
      version: typeof manifest.version === "string" ? manifest.version : undefined,
      description: typeof manifest.description === "string" ? manifest.description : undefined,
      author: typeof manifest.author === "string" ? manifest.author : undefined,
      main: typeof manifest.main === "string" ? manifest.main : "index.js",
      styles: Array.isArray(manifest.styles) ? manifest.styles.filter((style): style is string => typeof style === "string") : [],
      layerling: typeof manifest.layerling === "string" ? manifest.layerling : undefined,
      baseUrl,
      enabled: !disabled.includes(id),
    });
  }
  return listed.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readExtensionSettings(id: string): Promise<ExtensionValues> {
  const dir = extensionDataDir();
  if (!dir || !validExtensionId(id)) return {};
  return (await readJson<ExtensionValues>(path.join(dir, `${id}.json`))) ?? {};
}

export async function writeExtensionSettings(id: string, values: ExtensionValues) {
  const dir = extensionDataDir();
  if (!dir) throw new Error(`${EXTENSION_DATA_DIR_ENV} is not set`);
  if (!validExtensionId(id)) throw new Error("Not a valid extension id");
  const clean: ExtensionValues = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) clean[key] = value;
  }
  await writeJsonAtomic(path.join(dir, `${id}.json`), clean);
}

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".wasm": "application/wasm",
  ".stl": "model/stl",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

export function contentTypeFor(file: string) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}
