/** Numbers and dates as the panel shows them. */
export const formatNumber = (n: number): string => n.toLocaleString("en-US");

export const formatShortDate = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
