/** Reaching Bunsho support: an email the writer writes in their own mail app. The plugin itself sends nothing. */
export const SUPPORT_EMAIL = "support@bunsho.io";
/** Desktop shared/types/support.ts SUPPORT_REPLY_PROMISE. */
export const SUPPORT_REPLY_PROMISE = "We reply by email, usually within a day.";
export const HELP_CENTER_URL = "https://bunsho.io/docs";

/** A draft that says only which plugin it is from: never account details or manuscript text. */
export const supportMailto = (version: string): string => `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Bunsho for Obsidian ${version}`)}`;
