import { createHash } from "node:crypto";

/** SHA-256 hex of a string (page revisions and snapshot ids, as the desktop computes them). */
export const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
