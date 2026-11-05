/** The Free tier's one project, held by the engine (GET/POST /v1/projects/registration; plan from /v1/billing/subscription). */
import { planName } from "@/helpers/account";
import { projectState } from "@/helpers/project";
import type { PipelineV3Transport } from "@/lib/contract/pipelineV3Client";
import { postJson, tryGetJson, type ConnectionOptions } from "@/lib/services/engine/engineService";

/** The one-project state for this manuscript and the plan's name; never throws (an unreadable plan or registry reads as "unknown", and names no plan). */
export async function readProjectState(transport: PipelineV3Transport, workspaceId: string): Promise<ReturnType<typeof projectState> & { planName: string | null }> {
  const [subscription, registration] = await Promise.all([
    tryGetJson(transport, "/v1/billing/subscription"), tryGetJson(transport, "/v1/projects/registration"),
  ]);
  return { ...projectState(subscription, registration, workspaceId), planName: planName(subscription) };
}

/** Makes this manuscript the account's one free project. */
export async function registerProject(connection: ConnectionOptions, workspaceId: string, name: string): Promise<void> {
  await postJson(connection, "/v1/projects/registration", { workspaceId, name });
}
