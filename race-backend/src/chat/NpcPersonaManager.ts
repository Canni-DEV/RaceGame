import fs from "fs";
import path from "path";
import { NPC_PERSONA_PATH } from "../config";
import { parseSimpleYaml } from "../game/SimpleYamlParser";

export interface NpcPersona {
  name: string;
  persona: string;
  tone?: string;
  language?: string;
  allowEnglish?: boolean;
  maxReplyLength?: number;
}

type RawPersonaDefinition = Record<string, unknown>;

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_PERSONA_FILES = [
  "npc_personas.yml",
  "npc_personas.yaml",
  path.join("assets", "npc_personas.yml"),
  path.join("assets", "npc_personas.yaml")
];

export class NpcPersonaManager {
  private readonly personas: Map<string, NpcPersona>;

  constructor(configPath?: string) {
    const resolvedPath = this.resolveConfigPath(configPath ?? NPC_PERSONA_PATH);
    this.personas = this.loadPersonas(resolvedPath);
  }

  getPersona(npcId: string): NpcPersona | null {
    return this.personas.get(npcId) ?? null;
  }

  private loadPersonas(configPath: string | null): Map<string, NpcPersona> {
    const definitions = this.readDefinitions(configPath);
    const personas = new Map<string, NpcPersona>();
    if (!definitions) {
      return personas;
    }

    definitions.forEach((definition, index) => {
      const persona = this.normalizePersona(definition, index, configPath);
      if (!persona) {
        return;
      }
      if (personas.has(persona.name)) {
        console.warn(`[NpcPersonaManager] Persona duplicada para "${persona.name}" ignorada.`);
        return;
      }
      personas.set(persona.name, persona);
    });

    return personas;
  }

  private normalizePersona(
    definition: RawPersonaDefinition,
    index: number,
    sourcePath: string | null
  ): NpcPersona | null {
    const nameValue = definition["name"];
    const name = typeof nameValue === "string" ? nameValue.trim() : "";
    if (!name) {
      console.warn(
        `[NpcPersonaManager] Entrada ${index + 1} ${
          sourcePath ? `en "${sourcePath}" ` : ""
        }omitida porque no tiene un nombre valido.`
      );
      return null;
    }

    const personaValue = definition["persona"];
    const persona = typeof personaValue === "string" ? personaValue.trim() : "";
    if (!persona) {
      console.warn(
        `[NpcPersonaManager] Persona de "${name}" omitida porque no tiene descripcion.`
      );
      return null;
    }

    const tone = this.readString(definition["tone"]);
    const language = this.readString(definition["language"]);
    const allowEnglish = this.readBoolean(definition["allowEnglish"]);
    const maxReplyLength = this.readNumber(definition["maxReplyLength"]);

    return {
      name,
      persona,
      tone: tone ?? undefined,
      language: language ?? undefined,
      allowEnglish: allowEnglish ?? undefined,
      maxReplyLength: maxReplyLength ?? undefined
    };
  }

  private readString(value: unknown): string | null {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    return null;
  }

  private readNumber(value: unknown): number | null {
    const numeric =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number.parseFloat(value)
          : Number.NaN;
    return Number.isFinite(numeric) ? numeric : null;
  }

  private readBoolean(value: unknown): boolean | null {
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

  private readDefinitions(configPath: string | null): RawPersonaDefinition[] | null {
    if (!configPath) {
      return null;
    }
    try {
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = this.parseConfig(raw);
      const entries = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { personas?: unknown[] })?.personas)
          ? (parsed as { personas?: unknown[] }).personas
          : Array.isArray((parsed as { npcs?: unknown[] })?.npcs)
            ? (parsed as { npcs?: unknown[] }).npcs
            : null;
      if (!entries) {
        console.warn(
          `[NpcPersonaManager] El archivo "${configPath}" no tiene el formato esperado (array o propiedad "personas").`
        );
        return null;
      }
      return entries as RawPersonaDefinition[];
    } catch (error) {
      console.warn(`[NpcPersonaManager] No se pudo leer el archivo "${configPath}".`, error);
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
      throw new Error("Formato de configuracion no soportado");
    }
    return yamlResult;
  }

  private resolveConfigPath(override?: string | null): string | null {
    const candidates: string[] = [];

    if (override && override.trim()) {
      candidates.push(override.trim());
    }

    DEFAULT_PERSONA_FILES.forEach((candidate) => candidates.push(candidate));

    for (const candidate of candidates) {
      const resolved = path.isAbsolute(candidate) ? candidate : path.join(PROJECT_ROOT, candidate);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    }

    return null;
  }
}
