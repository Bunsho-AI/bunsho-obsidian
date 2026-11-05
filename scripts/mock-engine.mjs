/**
 * A stand-in for bunsho-engine's v3 review route, for tests and for driving the plugin without spending model credits.
 * It speaks the real frame protocol: a strict start, every whole page and passages frame before it runs, and a charge from the
 * characters sent whole. It reports a contradiction when two chapters give different eye colours ("her eyes were green" ...
 * "her eyes were brown"), or call a boat two things ("the boat was red" ... "the boat was blue", a lower-ranked finding), citing
 * exact offsets in the text it received. Like the engine it keys a finding by what it cites, reads only pages it has no usable
 * read for, and returns only findings touching the pages checked.
 *
 *   node scripts/mock-engine.mjs 8799 [--paid] [--other-project] [--enforce] [--balance N]
 *
 * POST /__mock with JSON changes its behaviour while it runs: see `options` below.
 */
import { createHash } from "node:crypto";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";

const PROTOCOL = "pipeline-v3";
export const POLICY_ID = "a".repeat(64);
export const READ_POLICY_ID = "b".repeat(64);

const frame = (type, payload) => JSON.stringify({ protocol: PROTOCOL, type, ...(payload === undefined ? {} : { payload }) });
const RULES = [
  { pattern: /eyes (?:were|was) (\w+)[^.\n]*\./giu, type: "trait_contradiction", severity: "error", subject: "Mira", attribute: "eye colour", dimension: "appearance:eye_color", kind: "trait", question: "What colour are her eyes?",
    message: (a, b) => `Her eye colour changes from ${a} to ${b}.` },
  { pattern: /boat (?:was|is) (\w+)[^.\n]*\./giu, type: "object_state_violation", severity: "warning", subject: "the boat", attribute: "colour", dimension: "other", kind: "object_state", question: "What colour is the boat?",
    message: (a, b) => `The boat changes from ${a} to ${b}.` },
];
const START_KEYS = new Set(["reviewId", "workspaceId", "snapshotId", "scope", "policyId", "readPolicyId", "pages", "cachedReads", "pins", "focusNames", "maxCredits"]);

const sha = (text) => createHash("sha256").update(text).digest("hex");

/** Every sentence a rule matches in `text`, whose first character is `base` into the page. */
function sentences(rule, text, base = 0) {
  return [...text.matchAll(rule.pattern)].map((match) => {
    const line = text.lastIndexOf("\n", match.index) + 1;
    const stop = text.slice(line, match.index).lastIndexOf(". ");
    const from = stop >= 0 ? line + stop + 2 : line;
    const to = match.index + match[0].length;
    return { color: match[1].toLowerCase(), from: base + from, to: base + to, quote: text.slice(from, to) };
  });
}

/** What the review can see of a page: all of it, the passages sent, or the facts of a cached read. */
function sightings(rule, meta, pages, passages, cached) {
  if (pages.has(meta.pageId)) return sentences(rule, pages.get(meta.pageId));
  const seen = new Map();
  for (const paragraph of passages.get(meta.pageId) ?? []) for (const s of sentences(rule, paragraph.text, paragraph.start)) seen.set(s.from, s);
  for (const fact of cached.get(meta.pageId)?.facts ?? []) {
    if (fact.attribute === rule.attribute && !seen.has(fact.span.start)) seen.set(fact.span.start, { color: fact.value, from: fact.span.start, to: fact.span.end, quote: fact.quote });
  }
  return [...seen.values()];
}

export function findings(start, pages, passages = new Map(), cachedReads = []) {
  const cached = new Map(cachedReads.filter((read) => read.rev === start.pages.find((p) => p.pageId === read.pageId)?.rev).map((read) => [read.pageId, read]));
  const issues = [];
  for (const rule of RULES) {
    const seen = [...start.pages].sort((a, b) => a.order - b.order).flatMap((meta) => sightings(rule, meta, pages, passages, cached).map((s) => ({ meta, ...s })));
    for (let i = 0; i < seen.length; i++) {
      const later = seen.slice(i + 1).find((s) => s.color !== seen[i].color);
      if (!later) continue;
      if (!pages.has(seen[i].meta.pageId) && !pages.has(later.meta.pageId)) continue; // a result holds only findings touching checked pages
      const cite = (s, role) => ({ page_id: s.meta.pageId, page_order: s.meta.order, quoted_text: s.quote, location_label: `Chapter ${s.meta.order + 1}`,
        evidence_role: role, source_ref: { snapshotId: start.snapshotId, pageId: s.meta.pageId, rev: s.meta.rev, start: s.from, end: s.to } });
      const key = `finding-${sha([rule.type, `${seen[i].meta.pageId}:${seen[i].quote}`, `${later.meta.pageId}:${later.quote}`].join("|")).slice(0, 24)}`;
      issues.push({ issue_id: key, type: rule.type, severity: rule.severity, message: rule.message(seen[i].color, later.color), evidence_summary: rule.message(seen[i].color, later.color),
        related_node_ids: [], issue_confidence: 0.9,
        context_json: JSON.stringify({ origin: "pipeline_v3", clusterKey: key, verification: "grounded_evidence", confidenceKind: "model_reported", findingType: "contradiction", subject: rule.subject, policyId: start.policyId }),
        citations: [cite(seen[i], "prior_fact"), cite(later, "current_conflict")] });
      break;
    }
  }
  return issues;
}

/** A read per page, as the engine's `read` frame: one fact and one cast record for each thing a rule finds on the page. */
export function readsOf(start, pages) {
  return start.pages.filter((meta) => pages.has(meta.pageId)).map((meta) => {
    const text = pages.get(meta.pageId) ?? "";
    const facts = RULES.flatMap((rule) => sentences(rule, text).map((s, i) => ({
      id: `${meta.pageId}#${rule.attribute}${i}`, pageId: meta.pageId, order: meta.order, span: { start: s.from, end: s.to }, quote: s.quote, paragraph: 0,
      subject: rule.subject, attribute: rule.attribute, value: s.color, dimension: rule.dimension, counterpart: null, status: "fact", kind: rule.kind,
      statement: s.quote, question: rule.question, framing: "narration", speaker: null, textMarksUntrue: false,
    })));
    const cast = facts.length ? [{ pageId: meta.pageId, order: meta.order, name: "Mira", kind: "person", names: [{ name: "Mira", proper: true }], role: "", introducedAliases: [] }] : [];
    return { pageId: meta.pageId, order: meta.order, rev: meta.rev, facts, cast, narration: { person: "third", povCharacter: "", tense: "past" }, povBreaks: [], droppedFacts: 0 };
  });
}

export function startMockEngine({ port = 0, balance = 500, tamper = false, failWith = null, holdOpen = false, paid = false, registered = null, starter = 0, readingParts = true, enforce = false, tickMs = 250, ...more } = {}) {
  const requests = [];
  const starts = [];
  const sentPages = [];
  const sentPassages = [];
  const seenReviews = new Set();
  /** Set at start or through POST /__mock; each is what the real engine can do. */
  const options = {
    /** { code, message, charged }: refuses after charging and after streaming its reads, as a failure mid-run does. */
    failAfterReads: null,
    /** Refuses any cached read: a read the engine's start schema will not take fails the whole start. */
    refuseCached: false,
    /** Page ids it could not read; "all" for every whole page. */
    unread: [],
    /** Pairs left unjudged past the judge's cap. */
    capped: false,
    /** Finds nothing this run, as model variance can. */
    findNothing: false,
    /** Answers under another read policy. */
    readPolicy: null,
    failWith, tamper, tickMs, ...more,
  };
  let registration = registered; // { workspaceId, name } | null: the account's one free project
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers });
    const json = (body) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.url === "/v1/pipeline/v3/health") return json({ enabled: true, protocol: PROTOCOL, policyId: options.policyId ?? POLICY_ID, readPolicyId: options.currentReadPolicy ?? READ_POLICY_ID, model: "mock", jevModel: "mock",
      jevEndpoint: "mock", limits: { maxPageChars: 150000, maxBookChars: 3000000 },
      pricing: { creditsPerThousandChars: 12, minimumUnits: 3, rounding: "up_once_per_review", chars: "checked_text_with_spaces", canonCreditsPerThousandChars: 1, canonCreditsPerPin: 2 }, ...(readingParts ? { readingParts: true } : {}) });
    if (req.url === "/__mock" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => { const change = JSON.parse(raw || "{}"); if (typeof change.balance === "number") balance = change.balance; Object.assign(options, change); json({ ok: true, balance }); });
      return;
    }
    if (req.url === "/v1/credits/starter" && req.method === "POST") { // granted once per account, as on the engine
      if (starter > 0) { balance += starter; starter = 0; }
      return json({ balance, plan: 0, extra: balance, total: balance });
    }
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
    let running = false;
    const pages = new Map();
    const passages = new Map();
    const refuse = (code, message, charged = false) => { socket.send(frame("error", { code, message, charged })); return socket.close(1011); };
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === "cancel") return socket.close(1000);
      if (message.type === "start") {
        start = message.payload; starts.push(start);
        if (Object.keys(start).some((key) => !START_KEYS.has(key))) return refuse("invalid_request", "That request was not valid. You were not charged.");
        if (seenReviews.has(start.reviewId)) return refuse("duplicate_review", "The review could not start. You were not charged.");
        seenReviews.add(start.reviewId);
        if (start.scope !== "chapters" && start.pages.some((p) => p.send !== "whole")) return refuse("invalid_request", "That request was not valid. You were not charged.");
        if (options.refuseCached && start.cachedReads.length) return refuse("invalid_request", "That request was not valid. You were not charged.");
      }
      if (message.type === "page") {
        const meta = start?.pages.find((p) => p.pageId === message.payload.pageId);
        if (!meta || meta.send !== "whole") return refuse("invalid_request", "unexpected page");
        pages.set(message.payload.pageId, message.payload.text); sentPages.push(message.payload);
      }
      if (message.type === "passages") {
        const meta = start?.pages.find((p) => p.pageId === message.payload.pageId);
        if (!meta || meta.send !== "passages") return refuse("invalid_request", "unexpected passages");
        passages.set(message.payload.pageId, message.payload.paragraphs); sentPassages.push(message.payload);
      }
      if (!start || running || !start.pages.every((p) => (p.send === "whole" ? pages.has(p.pageId) : passages.has(p.pageId)))) return;
      running = true;
      if (!readingParts && start.pages.some((p) => p.part)) { // the engine's start schema is strict
        socket.send(frame("error", { code: "invalid_request", message: "That request was not valid. You were not charged.", charged: false }));
        return;
      }
      if (!paid && registration && registration.workspaceId !== start.workspaceId) { // the engine's one-project gate
        socket.send(frame("error", { code: "project_limit", message: `Your free plan covers one project, “${registration.name ?? "your other project"}”. Upgrade to check another manuscript. You were not charged.`, charged: false }));
        return socket.close(1011);
      }
      if (options.failWith) { socket.send(frame("error", { code: options.failWith, message: "The reading model is unavailable. You were not charged.", charged: false })); return socket.close(1011); }
      const chars = [...pages.values()].reduce((n, text) => n + text.length, 0);
      const units = Math.max(3, Math.ceil(chars / 1000));
      const credits = units * 12;
      if (start.maxCredits !== undefined && credits > start.maxCredits) return refuse("price_changed", "This review now costs more than the price you confirmed. Check the new price and try again. You were not charged.");
      if (enforce) {
        if (balance < credits) return refuse("insufficient_credits", "Not enough credits for this review. You were not charged.");
        balance -= credits;
      }
      socket.send(frame("accepted", { reviewId: start.reviewId, pages: start.pages.length, units, credits }));
      let step = 0;
      const stages = ["read", "cast", "search", "triage", "judge", "timeline", "names", "assemble"];
      const tick = setInterval(() => {
        if (step < stages.length) return socket.send(frame("progress", { stage: stages[step++], done: 1, total: 1 }));
        clearInterval(tick);
        const cachedAt = new Map(start.cachedReads.map((read) => [read.pageId, read.rev]));
        const reads = readsOf(start, pages);
        // Sent before the error frame on a charged failure: what the review bought is kept. A usable read is not read again.
        for (const read of reads) if (cachedAt.get(read.pageId) !== read.rev) socket.send(frame("read", read));
        if (options.failAfterReads) { socket.send(frame("error", options.failAfterReads)); return socket.close(1011); }
        const issues = options.findNothing ? [] : findings(start, pages, passages, start.cachedReads);
        const known = [...reads, ...start.cachedReads];
        const inBook = [...new Set(known.filter((read) => read.facts.length).map((read) => read.order))];
        const cast = inBook.length ? [{ id: "r0", name: "Mira", kind: "person", names: ["Mira"], properNames: ["Mira"], aliases: [], chapters: inBook, roles: [], introduced: [] }] : [];
        if (options.tamper) for (const issue of issues) issue.citations[options.tamper === "prior" ? 0 : 1].source_ref.end += 1; // cites text that was never sent
        const unreadPages = options.unread === "all" ? [...pages.keys()] : options.unread.filter((id) => pages.has(id));
        socket.send(frame("result", { reviewId: start.reviewId, policyId: start.policyId, readPolicyId: options.readPolicy ?? start.readPolicyId, issues, cast,
          stats: { chapters: start.pages.length, chaptersRead: reads.length, cachedReads: start.cachedReads.length, ...(options.capped ? { shortlistDropped: 3 } : {}) }, ...(unreadPages.length ? { unreadPages, refundedCredits: 12 } : {}) }));
        if (!holdOpen) socket.close(1000); // holdOpen: leave closing to the client, as the real engine's timing can
      }, options.tickMs);
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({
    port: server.address().port, requests, starts, sentPages, sentPassages, options, balance: () => balance, registration: () => registration, close: () => new Promise((done) => { wss.close(); server.closeAllConnections?.(); server.close(done); }),
  })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const after = (flag) => { const at = process.argv.indexOf(flag); return at >= 0 ? process.argv[at + 1] : undefined; };
  const engine = await startMockEngine({ port: Number(process.argv[2] ?? 8799), paid: process.argv.includes("--paid"), enforce: process.argv.includes("--enforce"), balance: Number(after("--balance") ?? 500),
    registered: process.argv.includes("--other-project") ? { workspaceId: "someone-elses-manuscript", name: "Nine Fathoms" } : null });
  console.log(`mock engine on http://127.0.0.1:${engine.port}`);
}
