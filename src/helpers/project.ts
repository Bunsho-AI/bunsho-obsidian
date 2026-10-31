/**
 * The Free tier's one-project rule, as the plugin sees it. The engine holds the account's one project
 * (GET/POST /v1/projects/registration, the same record the desktop app uses); a Free account is one without an active
 * subscription (GET /v1/billing/subscription). The engine also refuses a Free account's review for any other project,
 * so this client-side state is for the panel's wording, not the enforcement.
 */
export type ProjectState =
  /** Plan or registry could not be read: do not block (the engine decides). */
  | "unknown"
  /** A paid plan: no project limit. */
  | "paid"
  /** Free, and this manuscript is the registered project. */
  | "ok"
  /** Free, and no project is registered yet: this manuscript becomes it on the first check. */
  | "unregistered"
  /** Free, and another manuscript is the registered project. */
  | "blocked";

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** `subscription` and `registration` are the raw engine answers, or null when the read failed. */
export function projectState(subscription: unknown, registration: unknown, workspaceId: string): { state: ProjectState; registeredName: string | null } {
  if (!record(subscription) || typeof subscription.active !== "boolean") return { state: "unknown", registeredName: null };
  if (subscription.active) return { state: "paid", registeredName: null };
  if (!record(registration) || !("registration" in registration)) return { state: "unknown", registeredName: null };
  const current = registration.registration;
  if (current === null) return { state: "unregistered", registeredName: null };
  if (!record(current) || typeof current.workspaceId !== "string") return { state: "unknown", registeredName: null };
  const registeredName = typeof current.name === "string" && current.name.trim() ? current.name : null;
  return { state: current.workspaceId === workspaceId ? "ok" : "blocked", registeredName };
}
