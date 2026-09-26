import { z } from "zod";

/** Integer typed as text (form input); empty string allowed = "use default". */
export function optionalInt(min: number, max: number, label: string) {
  return z
    .string()
    .trim()
    .refine((v) => v === "" || (Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max), `${label} must be an integer between ${min} and ${max}.`);
}

/** Required integer typed as text. */
export function requiredInt(min: number, max: number, label: string) {
  return z
    .string()
    .trim()
    .min(1, `Enter ${label.toLowerCase()}.`)
    .refine((v) => Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max, `${label} must be an integer between ${min} and ${max}.`);
}

/** JSON text that must parse (optionally to an object). */
export function jsonText(label: string, options?: { object?: boolean; optional?: boolean }) {
  return z.string().refine(
    (v) => {
      if (options?.optional && v.trim() === "") return true;
      try {
        const parsed = JSON.parse(v);
        return !options?.object || (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed));
      } catch {
        return false;
      }
    },
    options?.object ? `${label} must be a valid JSON object.` : `${label} must be valid JSON.`,
  );
}
