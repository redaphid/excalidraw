import { isToken, profileTypeOf } from "./designTokens";

import type { ThemeTokens } from "./designTokens";

type Node = Record<string, unknown>;

const isRecord = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A DTCG composite value written bare: a color, a dimension or duration, a
 * typography, shadow, stroke style, border or transition. Any other object
 * in an override is a group.
 */
const isCompositeValue = (node: Node) =>
  "colorSpace" in node ||
  ("value" in node && "unit" in node) ||
  "fontFamily" in node ||
  "offsetX" in node ||
  "dashArray" in node ||
  "timingFunction" in node ||
  ("color" in node && "width" in node && "style" in node);

const isGroup = (value: unknown): value is Node =>
  isRecord(value) && !isToken(value) && !isCompositeValue(value);

/** what a token keeps of the one it replaces */
const DESCRIBING = ["$type", "$description", "$extensions", "$deprecated"];

/** Combines two overrides' trees, the later one winning at each leaf. */
const combine = (a: unknown, b: unknown): unknown => {
  if (!isGroup(a) || !isGroup(b)) {
    return b;
  }
  const combined: Node = { ...a };
  for (const [key, value] of Object.entries(b)) {
    combined[key] = key in combined ? combine(combined[key], value) : value;
  }
  return combined;
};

/** `{ "color.accent": x }` as `{ color: { accent: x } }`; DTCG names have no dots */
const expandPaths = (node: Node): Node => {
  let expanded: Node = {};
  for (const [key, raw] of Object.entries(node)) {
    const value = isGroup(raw) && !key.startsWith("$") ? expandPaths(raw) : raw;
    const nested = (
      key.startsWith("$") ? [key] : key.split(".")
    ).reduceRight<unknown>((inner, name) => ({ [name]: inner }), value);
    expanded = combine(expanded, nested) as Node;
  }
  return expanded;
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

const merge = (base: Node, override: Node, path: string[]): Node => {
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
    } else if (isGroup(value)) {
      const group = merge(isGroup(current) ? current : {}, value, [
        ...path,
        key,
      ]);
      // a group that only removed tokens which were not there adds nothing
      if (Object.keys(group).length || isGroup(current)) {
        merged[key] = group;
      }
    } else {
      const token =
        isRecord(value) && isToken(value) ? value : { $value: value };
      const kept =
        isRecord(current) && isToken(current)
          ? Object.fromEntries(
              DESCRIBING.filter((name) => name in current).map((name) => [
                name,
                current[name],
              ]),
            )
          : {};
      const type = profileTypeOf([...path, key].join("."));
      merged[key] = {
        ...(type && { $type: type }),
        ...kept,
        ...token,
      };
    }
  }
  return merged;
};

/**
 * Layers partial design token documents over a base theme, in order, and
 * returns a new document; the inputs are left alone. A token is replaced
 * whole but keeps the `$type` and `$description` of the token it replaces,
 * and a new token at a profile path gets the profile's `$type`. A bare value
 * is read as `{ $value }`, a dotted key such as `"color.accent"` as a token
 * path, and `null` removes a token or group. `$extensions` merge field by
 * field.
 *
 * `mergeThemeTokens(terminal, { "color.accent": "#2dd4bf" })`
 */
export const mergeThemeTokens = (
  base: ThemeTokens,
  ...overrides: ThemeTokens[]
): ThemeTokens =>
  overrides.reduce<Node>(
    (merged, override) => merge(merged, expandPaths(override), []),
    { ...base },
  );
