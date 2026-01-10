import fs from "fs";
import path from "path";
import { createNpcBehaviorConfig, NpcBehaviorConfig } from "./NpcController";

export interface NpcProfile {
  name: string;
  behavior: NpcBehaviorConfig;
  active: boolean;
}

type RawNpcDefinition = Record<string, unknown>;
type RangeNpcKey = "mistakeDurationRange" | "mistakeCooldownRange";
type NumericNpcKey = Exclude<keyof NpcBehaviorConfig, RangeNpcKey>;

const NUMERIC_NPC_KEYS: NumericNpcKey[] = [
  "minTargetThreshold",
  "targetThresholdFactor",
  "minLookahead",
  "maxLookahead",
  "lookaheadSpeedFactor",
  "baseThrottle",
  "minThrottle",
  "throttleCornerPenalty",
  "recoveryBrakeAngle",
  "offTrackThrottleScale",
  "offTrackBrake",
  "steerResponse",
  "mistakeSteerBias",
  "mistakeTriggerChance",
  "approachThrottleScale",
  "approachBrake",
  "approachDistanceRatio"
];

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_CONFIG_FILES = [
  "npcs.yml",
  "npcs.yaml",
  path.join("assets", "npcs.yml"),
  path.join("assets", "npcs.yaml")
];

const FALLBACK_NPCS: RawNpcDefinition[] = [
  {
    name: "Garburator",
    active: true,
    baseThrottle: 0.86,
    lookaheadSpeedFactor: 0.8,
    mistakeTriggerChance: 0.28,
    mistakeCooldownRange: [2, 5]
  },
  {
    name: "Petrucci",
    active: true,
    baseThrottle: 0.78,
    minThrottle: 0.38,
    throttleCornerPenalty: 0.45,
    steerResponse: Math.PI / 3.4,
    lookaheadSpeedFactor: 0.95,
    mistakeTriggerChance: 0.18,
    mistakeDurationRange: [0.25, 0.6],
    mistakeCooldownRange: [2.5, 6.5]
  },
  {
    name: "Arthur Morgan",
    active: true,
    baseThrottle: 0.9,
    throttleCornerPenalty: 0.65,
    steerResponse: Math.PI / 2.8,
    offTrackThrottleScale: 0.6,
    offTrackBrake: 0.45,
    mistakeSteerBias: Math.PI / 10,
    mistakeTriggerChance: 0.45,
    approachThrottleScale: 0.6,
    approachBrake: 0.25
  }
];

export class NpcManager {
  private readonly profiles: NpcProfile[];

  constructor(configPath?: string) {
    const resolvedPath = this.resolveConfigPath(configPath);
    this.profiles = this.loadProfiles(resolvedPath);
  }

  getActiveProfiles(): NpcProfile[] {
    return this.profiles
      .filter((profile) => profile.active)
      .map((profile) => ({
        name: profile.name,
        behavior: { ...profile.behavior },
        active: profile.active
      }));
  }

  private loadProfiles(configPath: string | null): NpcProfile[] {
    const definitions = this.readDefinitions(configPath) ?? FALLBACK_NPCS;
    const profiles: NpcProfile[] = [];
    const seen = new Set<string>();

    definitions.forEach((definition, index) => {
      const profile = this.normalizeProfile(definition, index, configPath);
      if (!profile || profile.active === false) {
        return;
      }
      if (seen.has(profile.name)) {
        console.warn(`[NpcManager] Se ignoró un NPC duplicado con nombre "${profile.name}".`);
        return;
      }
      seen.add(profile.name);
      profiles.push(profile);
    });

    return profiles;
  }

  private normalizeProfile(
    definition: RawNpcDefinition,
    index: number,
    sourcePath: string | null
  ): NpcProfile | null {
    const nameValue = definition["name"];
    const name = typeof nameValue === "string" ? nameValue.trim() : "";
    if (!name) {
      console.warn(
        `[NpcManager] Entrada ${index + 1} ${
          sourcePath ? `en "${sourcePath}" ` : ""
        }omitida porque no tiene un nombre válido.`
      );
      return null;
    }

    const active = this.parseBoolean(definition["active"]);
    const behaviorOverrides = this.extractBehavior(definition);

    return {
      name,
      behavior: createNpcBehaviorConfig(behaviorOverrides),
      active: active ?? true
    };
  }

  private extractBehavior(definition: RawNpcDefinition): Partial<NpcBehaviorConfig> {
    const overrides: Partial<NpcBehaviorConfig> = {};

    for (const key of NUMERIC_NPC_KEYS) {
      this.assignNumber(definition, overrides, key);
    }
    this.assignRange(definition, overrides, "mistakeDurationRange");
    this.assignRange(definition, overrides, "mistakeCooldownRange");

    return overrides;
  }

  private assignNumber(
    source: RawNpcDefinition,
    target: Partial<NpcBehaviorConfig>,
    key: NumericNpcKey
  ): void {
    const value = this.parseNumber(source[key]);
    if (value !== null) {
      target[key] = value;
    }
  }

  private assignRange(
    source: RawNpcDefinition,
    target: Partial<NpcBehaviorConfig>,
    key: RangeNpcKey
  ): void {
    const range = this.parseNumberRange(source[key]);
    if (range) {
      target[key] = range;
    }
  }

  private parseNumber(value: unknown): number | null {
    const numeric =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number.parseFloat(value)
          : Number.NaN;
    return Number.isFinite(numeric) ? numeric : null;
  }

  private parseNumberRange(value: unknown): [number, number] | null {
    if (!Array.isArray(value) || value.length !== 2) {
      return null;
    }
    const first = this.parseNumber(value[0]);
    const second = this.parseNumber(value[1]);
    if (first === null || second === null) {
      return null;
    }
    return [first, second];
  }

  private parseBoolean(value: unknown): boolean | null {
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

  private readDefinitions(configPath: string | null): RawNpcDefinition[] | null {
    if (!configPath) {
      return null;
    }
    try {
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = this.parseConfig(raw);
      const entries = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { npcs?: unknown[] })?.npcs)
          ? (parsed as { npcs?: unknown[] }).npcs
          : null;
      if (!entries) {
        console.warn(
          `[NpcManager] El archivo "${configPath}" no tiene el formato esperado (array o propiedad "npcs").`
        );
        return null;
      }
      return entries as RawNpcDefinition[];
    } catch (error) {
      console.warn(`[NpcManager] No se pudo leer el archivo "${configPath}".`, error);
      return null;
    }
  }

  private parseConfig(content: string): unknown {
    try {
      return JSON.parse(content);
    } catch {
      // Not JSON
    }

    const yamlResult = parseSimpleYaml(content);
    if (yamlResult === null) {
      throw new Error("Formato de configuración no soportado");
    }
    return yamlResult;
  }

  private resolveConfigPath(override?: string): string | null {
    const candidates: string[] = [];
    const envPath = process.env.NPC_CONFIG_PATH;

    if (override && override.trim()) {
      candidates.push(this.normalizePath(override.trim()));
    } else if (envPath && envPath.trim()) {
      candidates.push(this.normalizePath(envPath.trim()));
    } else {
      DEFAULT_CONFIG_FILES.forEach((file) => candidates.push(this.normalizePath(file)));
    }

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return candidates.length > 0 ? candidates[0] : null;
  }

  private normalizePath(value: string): string {
    return path.isAbsolute(value) ? value : path.resolve(PROJECT_ROOT, value);
  }
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
  if (value.startsWith("[") && value.endsWith("]")) {
    const list = parseInlineList(value);
    if (list !== null) {
      return list;
    }
  }

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

function parseInlineList(text: string): unknown[] | null {
  const inner = text.slice(1, -1).trim();
  if (inner.length === 0) {
    return [];
  }
  const parts = inner.split(",").map((part) => part.trim());
  const values = parts
    .map(parseScalarValue)
    .filter((v) => v !== undefined);
  return values;
}

function parseScalarValue(value: string): unknown {
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

