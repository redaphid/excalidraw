import type { ThemeTokens } from "./designTokens";

type Node = Record<string, unknown>;

const isRecord = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isToken = (node: Node) => "$value" in node || "$ref" in node;

/** `{ "color.accent": x }` as `{ color: { accent: x } }`; DTCG names have no dots */
const expandPaths = (node: Node): Node => {
  const expanded: Node = {};
  for (const [key, raw] of Object.entries(node)) {
    const path = key.startsWith("$") ? [key] : key.split(".");
    const value =
      isRecord(raw) && !key.startsWith("$") && !isToken(raw)
        ? expandPaths(raw)
        : raw;
    const leaf = path.pop()!;
    const parent = path.reduce<Node>((at, name) => {
      if (!isRecord(at[name])) {
        at[name] = {};
      }
      return at[name] as Node;
    }, expanded);
    const existing = parent[leaf];
    parent[leaf] =
      isRecord(existing) && isRecord(value) && !isToken(value)
        ? { ...existing, ...value }
        : value;
  }
  return expanded;
};

const merge = (base: Node, override: Node): Node => {
  const merged: Node = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    if (value === null) {
      delete merged[key];
    } else if (key.startsWith("$")) {
      merged[key] =
        key === "$extensions" && isRecord(current) && isRecord(value)
          ? deepMerge(current, value)
          : value;
    } else if (!isRecord(value) || isToken(value)) {
      const token = isRecord(value) ? value : { $value: value };
      const { $value, $ref, ...kept } = isRecord(current) ? current : {};
      merged[key] = { ...kept, ...token };
    } else {
      merged[key] = merge(isRecord(current) ? current : {}, value);
    }
  }
  return merged;
};

const deepMerge = (base: Node, override: Node): Node => {
  const merged: Node = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    if (value === null) {
      delete merged[key];
    } else {
      merged[key] =
        isRecord(current) && isRecord(value)
          ? deepMerge(current, value)
          : value;
    }
  }
  return merged;
};

/**
 * Layers partial design token documents over a base theme, in order, and
 * returns a new document; the inputs are left alone. A token is replaced
 * whole but keeps the `$type` and `$description` of the token it replaces.
 * A bare value is read as `{ $value }`, a dotted key such as
 * `"color.accent"` as a token path, and `null` removes a token or group.
 * `$extensions` merge field by field.
 *
 * `mergeThemeTokens(terminal, { "color.accent": "#2dd4bf" })`
 */
export const mergeThemeTokens = (
  base: ThemeTokens,
  ...overrides: ThemeTokens[]
): ThemeTokens =>
  overrides.reduce<Node>(
    (merged, override) => merge(merged, expandPaths(override)),
    { ...base },
  );
