/** The slice of the engine wire types the plugin reads (mirrors desktop engine.types.ts; one contract). */
import type { SourceReference } from "./sourceReference";

export interface EngineIssueCitation {
  source_ref?: SourceReference;
  focus_source_ref?: SourceReference;
  page_id: string;
  chunk_id?: string;
  quoted_text: string;
  focus_text?: string;
  location_label: string;
  page_order: number;
  evidence_role: string;
  source_type?: string;
  degraded_location?: boolean;
}

export interface EngineIssue {
  issue_id: string;
  type: string;
  severity: "error" | "warning" | "info";
  message: string;
  related_node_ids: string[];
  context_json: string;
  citations: EngineIssueCitation[];
  issue_confidence: number;
  verifier_confidence?: number;
  evidence_summary?: string;
  [key: string]: unknown;
}
