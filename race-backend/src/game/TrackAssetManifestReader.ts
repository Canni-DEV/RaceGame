import fs from "fs";
import path from "path";
import { TrackAssetLibraryConfig } from "../config";
import { InstanceMeshKind } from "../types/trackTypes";

export interface AssetDescriptor {
  id: string;
  mesh: InstanceMeshKind;
  fileName?: string;
  nodeIndex?: number;
  side: 1 | -1 | 0;
  size?: number;
  offset?: number;
  density?: number;
  every?: number;
  minSpacing?: number;
  maxInstances?: number;
  segment?: "any" | "straight" | "curve";
  zone?: "any" | "outer";
  minDistance?: number;
  maxDistance?: number;
  seedOffset?: number;
  alignToTrack?: boolean;
}

interface ManifestEntry {
  file?: unknown;
  fileName?: unknown;
  mesh?: unknown;
  node?: unknown;
  nodeIndex?: unknown;
  side?: unknown;
  size?: unknown;
  scale?: unknown;
  offset?: unknown;
  density?: unknown;
  frequency?: unknown;
  every?: unknown;
  minSpacing?: unknown;
  spacing?: unknown;
  max?: unknown;
  segment?: unknown;
  zone?: unknown;
  minDistance?: unknown;
  maxDistance?: unknown;
  seed?: unknown;
  alignToTrack?: unknown;
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
    candidates.push(path.join(directory, "manifest.example.yml"));
    candidates.push(path.join(directory, "manifest.example.yaml"));
    candidates.push(path.join(directory, "manifest.example.json"));
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
    entries.forEach((entry: unknown, index: number) => {
      const descriptor = normalizeEntry(entry, index);
      if (!descriptor) {
        return;
      }
      if (descriptor.fileName) {
        const assetPath = path.join(assetDirectory, descriptor.fileName);
        if (!fs.existsSync(assetPath)) {
          console.warn(
            `[TrackAssetManifest] Se ignoró la entrada ${index + 1} porque el archivo "${descriptor.fileName}" no existe en "${assetDirectory}".`
          );
          return;
        }
      }

      descriptors.push(descriptor);
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
  const mesh = normalizeMesh(manifestEntry.mesh, fileName);
  if (!mesh) {
    console.warn(
      `[TrackAssetManifest] La entrada ${index + 1} no tiene un recurso válido (defina "file" o "mesh").`
    );
    return null;
  }

  if (mesh === "gltf" && !fileName) {
    console.warn(`[TrackAssetManifest] La entrada ${index + 1} requiere un archivo .glb.`);
    return null;
  }

  const nodeNumber = normalizeNodeNumber(manifestEntry.node ?? manifestEntry.nodeIndex);
  const nodeProvided = manifestEntry.node !== undefined || manifestEntry.nodeIndex !== undefined;
  if (nodeProvided && nodeNumber === null) {
    console.warn(`[TrackAssetManifest] La entrada ${index + 1} tiene un índice de nodo inválido.`);
    return null;
  }

  const side = normalizeSide(manifestEntry.side);
  const size = normalizePositiveNumber(manifestEntry.scale ?? manifestEntry.size);
  const density = normalizePositiveNumber(manifestEntry.density ?? manifestEntry.frequency);
  const every = normalizePositiveInteger(manifestEntry.every);
  const minSpacing = normalizePositiveNumber(manifestEntry.minSpacing ?? manifestEntry.spacing);
  const maxInstances = normalizePositiveInteger(manifestEntry.max);
  const offset = normalizePositiveNumber(manifestEntry.offset);
  const minDistance = normalizePositiveNumber(manifestEntry.minDistance);
  const maxDistance = normalizePositiveNumber(manifestEntry.maxDistance);
  const seedOffset = normalizeNumber(manifestEntry.seed);
  const alignToTrack = normalizeBoolean(manifestEntry.alignToTrack);

  return {
    id: fileName ?? `entry-${index + 1}`,
    mesh,
    ...(fileName ? { fileName } : {}),
    ...(nodeNumber !== null ? { nodeIndex: nodeNumber - 1 } : {}),
    side,
    ...(size !== null ? { size } : {}),
    ...(density !== null ? { density } : {}),
    ...(every !== null ? { every } : {}),
    ...(minSpacing !== null ? { minSpacing } : {}),
    ...(maxInstances !== null ? { maxInstances } : {}),
    ...(offset !== null ? { offset } : {}),
    ...(minDistance !== null ? { minDistance } : {}),
    ...(maxDistance !== null ? { maxDistance } : {}),
    ...(seedOffset !== null ? { seedOffset } : {}),
    ...(alignToTrack !== null ? { alignToTrack } : {}),
    segment: normalizeSegment(manifestEntry.segment),
    zone: normalizeZone(manifestEntry.zone)
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

function normalizeMesh(value: unknown, fileName: string | null): InstanceMeshKind | null {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "tree" || normalized === "procedural-tree" || normalized === "foliage") {
      return "procedural-tree";
    }
    if (normalized === "gltf" || normalized === "asset" || normalized === "mesh") {
      return "gltf";
    }
  }
  if (fileName) {
    return "gltf";
  }
  return null;
}

function normalizeNodeNumber(value: unknown): number | null {
  if (value === undefined) {
    return null;
  }
  const numberValue = parseFloatValue(value);
  if (numberValue === null) {
    return null;
  }
  const rounded = Math.round(numberValue);
  return rounded > 0 ? rounded : null;
}

function normalizeSide(value: unknown): 1 | -1 | 0 {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "both" || normalized === "any" || normalized === "0") {
      return 0;
    }
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

function normalizeSegment(value: unknown): "any" | "straight" | "curve" {
  if (typeof value !== "string") {
    return "any";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("straight")) {
    return "straight";
  }
  if (normalized.startsWith("curve") || normalized === "turn") {
    return "curve";
  }
  return "any";
}

function normalizeZone(value: unknown): "any" | "outer" {
  if (typeof value !== "string") {
    return "any";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("outer") || normalized === "outside") {
    return "outer";
  }
  return "any";
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
        descriptors.push({ fileName: file, id: file, mesh: "gltf", ...placement });
      }
    }
    return descriptors;
  } catch (error) {
    console.warn(`[TrackAssetPlanner] Unable to read asset directory "${directory}"`, error);
    return [];
  }
}

function parsePlacement(fileName: string): Omit<AssetDescriptor, "fileName" | "mesh" | "id"> | null {
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
  const numberValue = parseFloatValue(value);
  if (numberValue !== null) {
    return numberValue;
  }
  return value;
}

function parseFloatValue(value: unknown): number | null {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizePositiveNumber(value: unknown): number | null {
  const numberValue = parseFloatValue(value);
  if (numberValue === null) {
    return null;
  }
  return numberValue > 0 ? numberValue : null;
}

function normalizePositiveInteger(value: unknown): number | null {
  const numberValue = normalizePositiveNumber(value);
  if (numberValue === null) {
    return null;
  }
  const rounded = Math.round(numberValue);
  return rounded > 0 ? rounded : null;
}

function normalizeNumber(value: unknown): number | null {
  const numberValue = parseFloatValue(value);
  return numberValue !== null ? numberValue : null;
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return null;
}
