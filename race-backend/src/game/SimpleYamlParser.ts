type SimpleYamlResult = any[] | Record<string, unknown> | null;

export function parseSimpleYaml(content: string): SimpleYamlResult {
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
