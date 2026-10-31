/**
 * A stand-in for bunsho-engine's v3 review route, for tests and for driving the plugin without spending model credits.
 * It speaks the real frame protocol and reports a contradiction when two chapters give a person different eye colours
 * ("her eyes were green" ... "her eyes were brown"), citing exact offsets in the text it received.
 *
 *   node scripts/mock-engine.mjs 8799
 */
import http from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";

const PROTOCOL = "pipeline-v3";
export const POLICY_ID = "a".repeat(64);
export const READ_POLICY_ID = "b".repeat(64);

const frame = (type, payload) => JSON.stringify({ protocol: PROTOCOL, type, ...(payload === undefined ? {} : { payload }) });
const EYES = /eyes (?:were|was) (\w+)[^.\n]*\./giu;

export function findings(start, pages) {
  const seen = [];
  for (const meta of [...start.pages].sort((a, b) => a.order - b.order)) {
    const text = pages.get(meta.pageId) ?? "";
    for (const match of text.matchAll(EYES)) {
      const sentenceStart = text.lastIndexOf("\n", match.index) + 1;
      const from = text.slice(sentenceStart, match.index).lastIndexOf(". ") >= 0 ? sentenceStart + text.slice(sentenceStart, match.index).lastIndexOf(". ") + 2 : sentenceStart;
      const to = match.index + match[0].length;
      seen.push({ meta, color: match[1].toLowerCase(), from, to, quote: text.slice(from, to) });
    }
  }
  const issues = [];
  for (let i = 0; i < seen.length; i++) {
    const later = seen.slice(i + 1).find((s) => s.color !== seen[i].color);
    if (!later) continue;
    const cite = (s, role) => ({ page_id: s.meta.pageId, page_order: s.meta.order, quoted_text: s.quote, location_label: `Chapter ${s.meta.order + 1}`,
      evidence_role: role, source_ref: { snapshotId: start.snapshotId, pageId: s.meta.pageId, rev: s.meta.rev, start: s.from, end: s.to } });
    issues.push({ issue_id: `finding-mock-${i}`, type: "trait_conflict", severity: "error", message: `Her eye colour changes from ${seen[i].color} to ${later.color}.`,
      related_node_ids: [], context_json: JSON.stringify({ origin: "pipeline_v3", clusterKey: `finding-mock-${i}` }), issue_confidence: 0.9,
      citations: [cite(seen[i], "prior_fact"), cite(later, "current_conflict")] });
    break;
  }
  return issues;
}

export function startMockEngine({ port = 0, balance = 500, tamper = false, failWith = null, holdOpen = false, paid = false, registered = null } = {}) {
  const requests = [];
  let registration = registered; // { workspaceId, name } | null: the account's one free project
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers });
    const json = (body) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.url === "/v1/pipeline/v3/health") return json({ enabled: true, protocol: PROTOCOL, policyId: POLICY_ID, readPolicyId: READ_POLICY_ID, model: "mock", jevModel: "mock",
      jevEndpoint: "mock", limits: { maxPageChars: 150000, maxBookChars: 3000000 },
      pricing: { creditsPerThousandChars: 12, minimumUnits: 3, rounding: "up_once_per_review", chars: "checked_text_with_spaces", canonCreditsPerThousandChars: 1, canonCreditsPerPin: 2 } });
    if (req.url === "/v1/credits") return json({ balance, plan: 0, extra: balance, total: balance });
    if (req.url === "/v1/billing/subscription") return json({ active: paid, tier: paid ? "storyteller" : null, status: paid ? "active" : null, renewsAt: null, cancelAtPeriodEnd: false, pendingTier: null, pendingAppliesAt: null });
    const wire = () => registration && { workspaceId: registration.workspaceId, name: registration.name ?? null, registeredAt: "2026-10-31T00:00:00.000Z", revision: 1 };
    if (req.url === "/v1/projects/registration" && req.method === "GET") return json({ registration: wire() });
    if (req.url === "/v1/projects/registration" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        const replaced = Boolean(registration && registration.workspaceId !== body.workspaceId);
        registration = { workspaceId: body.workspaceId, name: body.name ?? null };
        json({ registration: wire(), replaced, replaceCount: replaced ? 1 : 0 });
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  const wss = new WebSocketServer({ server, path: "/v1/pipeline/v3/review", perMessageDeflate: false });
  wss.on("connection", (socket, req) => {
    requests.push({ url: req.url, headers: req.headers, socket: true });
    let start = null;
    const pages = new Map();
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === "cancel") return socket.close(1000);
      if (message.type === "start") start = message.payload;
      if (message.type === "page") pages.set(message.payload.pageId, message.payload.text);
      if (!start || pages.size < start.pages.filter((p) => p.send === "whole").length) return;
      if (!paid && registration && registration.workspaceId !== start.workspaceId) { // the engine's one-project gate
        socket.send(frame("error", { code: "project_limit", message: `Your free plan covers one project, \u201c${registration.name ?? "your other project"}\u201d. Upgrade to check another manuscript. You were not charged.`, charged: false }));
        return socket.close(1011);
      }
      if (failWith) { socket.send(frame("error", { code: failWith, message: "The reading model is unavailable. You were not charged.", charged: false })); return socket.close(1011); }
      socket.send(frame("accepted", { reviewId: start.reviewId, pages: start.pages.length, units: 3, credits: 36 }));
      let step = 0;
      const stages = ["read", "cast", "search", "triage", "judge", "timeline", "names", "assemble"];
      const tick = setInterval(() => {
        if (step < stages.length) return socket.send(frame("progress", { stage: stages[step++], done: 1, total: 1 }));
        clearInterval(tick);
        const issues = findings(start, pages);
        if (tamper) for (const issue of issues) issue.citations[tamper === "prior" ? 0 : 1].source_ref.end += 1; // cites text that was never sent
        socket.send(frame("result", { reviewId: start.reviewId, policyId: start.policyId, readPolicyId: start.readPolicyId, issues, cast: [],
          stats: { chapters: start.pages.length } }));
        if (!holdOpen) socket.close(1000); // holdOpen: leave closing to the client, as the real engine's timing can

      }, 250);
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({
    port: server.address().port, requests, registration: () => registration, close: () => new Promise((done) => { wss.close(); server.closeAllConnections?.(); server.close(done); }),
  })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const engine = await startMockEngine({ port: Number(process.argv[2] ?? 8799), paid: process.argv.includes("--paid"),
    registered: process.argv.includes("--other-project") ? { workspaceId: "someone-elses-manuscript", name: "Nine Fathoms" } : null });
  console.log(`mock engine on http://127.0.0.1:${engine.port}`);
}
