import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Joins class names and resolves Tailwind conflicts so later classes win (e.g. `p-0` overrides a default `px-5`). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
