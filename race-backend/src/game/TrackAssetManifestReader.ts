import fs from "fs";
import path from "path";
import { TrackAssetLibraryConfig } from "../config";

export interface AssetDescriptor {
  fileName: string;
  nodeIndex: number;
  side: 1 | -1;
}

interface ManifestEntry {
  file?: unknown;
  fileName?: unknown;
  node?: unknown;
  nodeIndex?: unknown;
  side?: unknown;
}

export function loadAssetDescriptors(library: TrackAssetLibraryConfig): AssetDescriptor[] {
  const manifestPath = resolveManifestPath(library.directory, library.manifestPath);
  if (manifestPath) {
    const manifestDescriptors = readManifest(manifestPath, library.directory);
    if (manifestDescriptors.length > 0) {
      return manifestDescriptors;
    }
    console.warn(
      `[TrackAssetManifest] No se encontraron entradas válidas en "${manifestPath}", se usará el nombre del archivo como fallback.`
    );
  }

  return readFromDirectory(library.directory);
}

function resolveManifestPath(directory: string, override?: string): string | null {
  const candidates: string[] = [];

  if (override && override.trim().length > 0) {
    const normalized = override.trim();
    const resolved = path.isAbsolute(normalized) ? normalized : path.join(directory, normalized);
    candidates.push(resolved);
  }

  if (!override) {
    candidates.push(path.join(directory, "manifest.yml"));
    candidates.push(path.join(directory, "manifest.yaml"));
    candidates.push(path.join(directory, "manifest.json"));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  if (override) {
    console.warn(`[TrackAssetManifest] No se encontró el manifiesto configurado en "${candidates[0]}".`);
  }

  return null;
}

function readManifest(manifestPath: string, assetDirectory: string): AssetDescriptor[] {
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const parsed = parseManifest(raw);
    const entries = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as Record<string, unknown>)?.assets)
        ? (parsed as { assets: unknown[] }).assets
        : null;
    if (!entries) {
      console.warn(
        `[TrackAssetManifest] El manifiesto "${manifestPath}" no tiene el formato esperado (array de entradas).`
      );
      return [];
    }

    const descriptors: AssetDescriptor[] = [];
    const seenFiles = new Set<string>();
    entries.forEach((entry: unknown, index: number) => {
      const descriptor = normalizeEntry(entry, index);
      if (!descriptor) {
        return;
      }
      if (seenFiles.has(descriptor.fileName)) {
        console.warn(
          `[TrackAssetManifest] Se ignoró la entrada ${index + 1} porque el archivo "${descriptor.fileName}" está duplicado.`
        );
        return;
      }

      const assetPath = path.join(assetDirectory, descriptor.fileName);
      if (!fs.existsSync(assetPath)) {
        console.warn(
          `[TrackAssetManifest] Se ignoró la entrada ${index + 1} porque el archivo "${descriptor.fileName}" no existe en "${assetDirectory}".`
        );
        return;
      }

      descriptors.push(descriptor);
      seenFiles.add(descriptor.fileName);
    });

    return descriptors;
  } catch (error) {
    console.warn(`[TrackAssetManifest] No se pudo leer el manifiesto en "${manifestPath}"`, error);
    return [];
  }
}

function normalizeEntry(entry: unknown, index: number): AssetDescriptor | null {
  if (!entry || typeof entry !== "object") {
    console.warn(`[TrackAssetManifest] La entrada ${index + 1} no es un objeto válido.`);
    return null;
  }

  const manifestEntry = entry as ManifestEntry;
  const fileName = normalizeFileName(manifestEntry.file ?? manifestEntry.fileName);
  if (!fileName) {
    console.warn(`[TrackAssetManifest] La entrada ${index + 1} no tiene un nombre de archivo válido.`);
    return null;
  }

  const nodeNumber = normalizeNodeNumber(manifestEntry.node ?? manifestEntry.nodeIndex);
  if (nodeNumber === null) {
    console.warn(`[TrackAssetManifest] La entrada ${index + 1} tiene un índice de nodo inválido.`);
    return null;
  }

  const side = normalizeSide(manifestEntry.side);

  return {
    fileName,
    nodeIndex: nodeNumber - 1,
    side
  };
}

function normalizeFileName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const base = path.basename(trimmed);
  if (!base.toLowerCase().endsWith(".glb")) {
    return null;
  }
  return base;
}

function normalizeNodeNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value);
  if (rounded <= 0) {
    return null;
  }
  return rounded;
}

function normalizeSide(value: unknown): 1 | -1 {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "left" || normalized === "-" || normalized === "opposite") {
      return -1;
    }
    if (normalized === "right" || normalized === "+") {
      return 1;
    }
  }
  if (typeof value === "number" && value < 0) {
    return -1;
  }
  return 1;
}

function readFromDirectory(directory: string): AssetDescriptor[] {
  try {
    if (!fs.existsSync(directory)) {
      return [];
    }
    const entries = fs.readdirSync(directory).filter((file) => file.toLowerCase().endsWith(".glb"));
    entries.sort((a, b) => a.localeCompare(b));
    const descriptors: AssetDescriptor[] = [];
    for (const file of entries) {
      const placement = parsePlacement(file);
      if (placement) {
        descriptors.push({ fileName: file, ...placement });
      }
    }
    return descriptors;
  } catch (error) {
    console.warn(`[TrackAssetPlanner] Unable to read asset directory "${directory}"`, error);
    return [];
  }
}

function parsePlacement(fileName: string): Omit<AssetDescriptor, "fileName"> | null {
  const name = path.parse(fileName).name;
  const digitsMatch = name.match(/(\d+)$/);
  if (!digitsMatch) {
    return null;
  }
  const indexPart = digitsMatch[1];
  const prefix = name.slice(0, name.length - indexPart.length);
  const nodeNumber = Number.parseInt(indexPart, 10);
  if (!Number.isFinite(nodeNumber) || nodeNumber <= 0) {
    return null;
  }
  const isOppositeSide = prefix.endsWith("-");
  return {
    nodeIndex: nodeNumber - 1,
    side: isOppositeSide ? -1 : 1
  };
}

function parseManifest(content: string): any {
  try {
    return JSON.parse(content);
  } catch (jsonError) {
    // Not JSON; try a very small subset of YAML (list of flat mappings)
  }

  const yamlResult = parseSimpleYaml(content);
  if (yamlResult === null) {
    throw new Error("Unsupported manifest format");
  }
  return yamlResult;
}

function parseSimpleYaml(content: string): any[] | Record<string, unknown> | null {
  const cleanedLines = content
    .split(/\r?\n/)
    .map(stripComment)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  if (cleanedLines.length === 0) {
    return null;
  }

  const topLevelMatch = cleanedLines[0].match(/^([A-Za-z0-9_-]+):\s*$/);
  if (topLevelMatch) {
    const key = topLevelMatch[1];
    const nested = parseYamlList(cleanedLines.slice(1).map((line) => line.replace(/^\s{2}/, "")));
    if (nested) {
      return { [key]: nested };
    }
  }

  const directList = parseYamlList(cleanedLines);
  if (directList) {
    return directList;
  }

  return null;
}

function parseYamlList(lines: string[]): Record<string, unknown>[] | null {
  const entries: Record<string, unknown>[] = [];
  let current: Record<string, unknown> | null = null;

  for (const rawLine of lines) {
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = rawLine.trim();

    if (trimmed.startsWith("-")) {
      if (current) {
        entries.push(current);
      }
      current = {};
      const remainder = trimmed.slice(1).trim();
      if (remainder) {
        const kv = splitKeyValue(remainder);
        if (kv) {
          current[kv.key] = parseScalar(kv.value);
        }
      }
      continue;
    }

    if (indent >= 2 && current) {
      const kv = splitKeyValue(trimmed);
      if (kv) {
        current[kv.key] = parseScalar(kv.value);
      }
      continue;
    }
  }

  if (current) {
    entries.push(current);
  }

  return entries.length > 0 ? entries : null;
}

function stripComment(line: string): string {
  const hashIndex = line.indexOf("#");
  if (hashIndex === -1) {
    return line;
  }
  return line.slice(0, hashIndex);
}

function splitKeyValue(text: string): { key: string; value: string } | null {
  const colonIndex = text.indexOf(":");
  if (colonIndex === -1) {
    return null;
  }
  const key = text.slice(0, colonIndex).trim();
  const value = text.slice(colonIndex + 1).trim();
  if (!key) {
    return null;
  }
  return { key, value };
}

function parseScalar(value: string): unknown {
  if (value === "" || value === "null") {
    return null;
  }
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  const numberValue = Number(value);
  if (!Number.isNaN(numberValue)) {
    return numberValue;
  }
  return value;
}
