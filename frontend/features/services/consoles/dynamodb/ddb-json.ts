/**
 * DynamoDB attribute values in wire format ({"S": "x"}, {"N": "1"}, ...) and conversion to/from plain JSON.
 * Plain JSON is friendlier to edit; DynamoDB JSON keeps full fidelity (sets, binary).
 */

export type AttributeValue =
  | { S: string }
  | { N: string }
  | { B: string }
  | { BOOL: boolean }
  | { NULL: true }
  | { L: AttributeValue[] }
  | { M: Record<string, AttributeValue> }
  | { SS: string[] }
  | { NS: string[] }
  | { BS: string[] };

export type DynamoItem = Record<string, AttributeValue>;

const TYPES = ["S", "N", "B", "BOOL", "NULL", "L", "M", "SS", "NS", "BS"] as const;

export function attributeType(value: AttributeValue): string {
  return Object.keys(value)[0] ?? "S";
}

export function marshallValue(value: unknown): AttributeValue {
  if (value === null || value === undefined) return { NULL: true };
  if (typeof value === "string") return { S: value };
  if (typeof value === "number") return { N: String(value) };
  if (typeof value === "boolean") return { BOOL: value };
  if (Array.isArray(value)) return { L: value.map(marshallValue) };
  if (typeof value === "object") return { M: marshallItem(value as Record<string, unknown>) };
  return { S: String(value) };
}

export function marshallItem(obj: Record<string, unknown>): DynamoItem {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, marshallValue(v)]));
}

export function unmarshallValue(av: AttributeValue): unknown {
  if ("S" in av) return av.S;
  if ("N" in av) {
    const n = Number(av.N);
    return Number.isFinite(n) && String(n) === av.N.trim() ? n : av.N;
  }
  if ("BOOL" in av) return av.BOOL;
  if ("NULL" in av) return null;
  if ("L" in av) return av.L.map(unmarshallValue);
  if ("M" in av) return unmarshallItem(av.M);
  if ("SS" in av) return av.SS;
  if ("NS" in av) return av.NS.map(Number);
  if ("B" in av) return av.B;
  if ("BS" in av) return av.BS;
  return null;
}

export function unmarshallItem(item: DynamoItem): Record<string, unknown> {
  return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, unmarshallValue(v)]));
}

/** Loosely validates a DynamoDB JSON item and returns an error message when invalid. */
export function validateDynamoItem(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "The item must be a JSON object.";
  for (const [name, av] of Object.entries(value)) {
    if (typeof av !== "object" || av === null || Array.isArray(av)) return `Attribute "${name}" must be an object such as {"S": "value"}.`;
    const keys = Object.keys(av);
    if (keys.length !== 1 || !TYPES.includes(keys[0] as (typeof TYPES)[number])) return `Attribute "${name}" must have exactly one type descriptor (S, N, B, BOOL, NULL, L, M, SS, NS or BS).`;
  }
  return null;
}

/** Short display of an attribute value for table cells. */
export function displayValue(av: AttributeValue | undefined): string {
  if (!av) return "";
  if ("S" in av) return av.S;
  if ("N" in av) return av.N;
  if ("BOOL" in av) return String(av.BOOL);
  if ("NULL" in av) return "null";
  return JSON.stringify(unmarshallValue(av));
}

/** Stable JSON used to compare attribute values. */
export function sameValue(a: AttributeValue | undefined, b: AttributeValue | undefined) {
  return JSON.stringify(a) === JSON.stringify(b);
}
