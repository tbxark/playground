import { nanoid as generateRawNanoid } from "nanoid";

export function generateNanoid(size = 10): string {
  try {
    return generateRawNanoid(size);
  } catch {
    return Math.random().toString(36).substring(2, 2 + size);
  }
}
