/**
 * Pipeline v3 engine client: GET /v1/pipeline/v3/health over the EngineClient's HTTP request path,
 * and one review per WebSocket on /v1/pipeline/v3/review (contract: pipelineV3.types.ts).
 *
 * A review is one connection: `start`, then each page whole and each selected passage set, then the
 * engine streams progress and fresh chapter reads and answers with `result` or `error`. No
 * reconnect and no retry: an interrupted review saves nothing, and the writer starts it again.
 */
import WebSocket, { type RawData } from "ws";
import { CONTEXT_TOO_LARGE_MESSAGE, bookTooLargeMessage, tooManyChaptersMessage, type ChapterSizeLimit, type TooLargeKind } from "./tooLarge";
import { countWords } from "./countWords";
import { parsePipelineV3Health, parseServerFrame, validChapterRead } from "./pipelineV3Frames";
import {
  PIPELINE_V3_HEALTH_ROUTE, PIPELINE_V3_LIMITS, PIPELINE_V3_PROTOCOL, PIPELINE_V3_REVIEW_ROUTE,
  type ChapterRead, type ClaimsProgress, type PipelineV3Accepted, type PipelineV3ClientFrameType, type PipelineV3ErrorCode,
  type PipelineV3Health, type PipelineV3PageFrame, type PipelineV3PassagesFrame, type PipelineV3Result, type PipelineV3Start,
} from "./pipelineV3.types";

/** Engine error codes plus the ones this client raises itself (transport, admission, protocol). */
export type PipelineV3ClientErrorCode = PipelineV3ErrorCode
  | "unavailable" | "unauthorized" | "rate_limited" | "connection_lost" | "timed_out" | "protocol_error";

const MESSAGES: Record<PipelineV3ClientErrorCode, string> = {
  invalid_request: "The review request was not understood. Nothing was charged.",
  policy_mismatch: "The engine now reviews with a different policy. Try again.",
  too_large: "This manuscript is larger than one review can take.",
  insufficient_credits: "Not enough credits for this review.",
  budget_exceeded: "This review needed more model work than one review may use.",
  jev_unavailable: "The search service is unavailable. Chapter reads already made are kept for your next try.",
  model_unavailable: "The reading model is unavailable. Try again shortly.",
  cancelled: "Review cancelled.",
  timeout: "The review took too long to start.",
  duplicate_review: "The review could not start. Try again.",
  busy: "Another review is already running. Try again when it finishes.",
  slow_client: "The connection could not keep up with the review. Try again.",
  price_changed: "This review now costs more than the price you confirmed. Check the new price and try again.",
  internal: "The review failed unexpectedly.",
  unavailable: "This engine does not offer the new review pipeline. Review has not started.",
  unauthorized: "Sign in to review your manuscript.",
  rate_limited: "Too many reviews at once. Try again shortly.",
  connection_lost: "The review connection was interrupted. Nothing from this attempt was saved.",
  timed_out: "The review connection stopped responding. Nothing from this attempt was saved.",
  protocol_error: "The engine sent an invalid review message. Nothing from this attempt was saved.",
};

export interface PipelineV3ErrorDetail {
  closeCode?: number;
  status?: number;
  pageId?: string;
  /** From the engine's error frame: whether this review was charged. Unknown when the engine never said. */
  charged?: boolean;
  /** `price_changed`: what the review costs now, when the desktop knows. */
  credits?: number;
  /** `too_large`: which size refusal it is (the copy and the guide link follow it). */
  tooLarge?: TooLargeKind;
  /** `too_large` for one chapter: which of its limits it went over. */
  sizeLimit?: ChapterSizeLimit;
}

/**
 * A v3 review or health failure. `message` is finished writer-facing copy: the engine's own message
 * for an engine error frame (it states whether the review was charged), else this client's copy.
 */
export class PipelineV3Error extends Error {
  constructor(
    readonly code: PipelineV3ClientErrorCode,
    readonly detail: PipelineV3ErrorDetail = {},
    message?: string,
  ) {
    super(message ?? MESSAGES[code]);
    this.name = "PipelineV3Error";
  }
}

/** Estimated tokens of a page, as the engine estimates them (estimateTokens: UTF-8 bytes / 2.5, rounded up). */
export function estimatePipelineV3Tokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf8") / PIPELINE_V3_LIMITS.bytesPerTokenEstimate);
}

/** The engine refused the review because the account cannot pay for it (the v2 funding refusal's twin). */
export const isPipelineV3OutOfCredits = (error: unknown): boolean =>
  error instanceof PipelineV3Error && error.code === "insufficient_credits";
export const isPipelineV3Cancelled = (error: unknown): boolean =>
  error instanceof PipelineV3Error && error.code === "cancelled";

export interface PipelineV3Transport {
  baseUrl: string;
  /** Authenticated JSON GET (EngineClient.request): throws an error carrying `status` on a non-OK answer. */
  getJson(path: string): Promise<unknown>;
  /** The same headers the durable reader socket sends (Authorization: Bearer <Firebase JWT>, install id). */
  headers(): Promise<Record<string, string>>;
  logger: { warn(message: string, meta?: Record<string, unknown>): void; info(message: string, meta?: Record<string, unknown>): void };
}

export interface PipelineV3ClientOptions {
  /** No frame (the engine heartbeats every 10 s) for this long ends the review; also bounds the handshake. */
  idleTimeoutMs?: number;
  /** After a cancel, how long to wait for the engine's settled outcome. */
  cancelSettleMs?: number;
  /** Largest server frame accepted (a result carries every issue and the cast). */
  maxPayloadBytes?: number;
}

export interface PipelineV3ReviewRequest {
  start: PipelineV3Start;
  /** One per `start.pages` entry sent whole. */
  pages: readonly PipelineV3PageFrame[];
  /** One per `start.pages` entry sent as passages (possibly with no paragraphs). */
  passages: readonly PipelineV3PassagesFrame[];
}

export interface PipelineV3ReviewCallbacks {
  onAccepted?(accepted: PipelineV3Accepted): void;
  onProgress?(progress: ClaimsProgress): void;
  /** A freshly read chapter, already validated. Awaited before the result resolves; a throw is logged, never fatal. */
  onRead?(read: ChapterRead): void | Promise<void>;
}

const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const CHAPTER_TOO_LONG_MESSAGE = "One chapter note is too long to check. Split it into two notes and check again.";
/** After `cancel`, how long to wait for the engine to settle the charge and report it before giving up. */
const DEFAULT_CANCEL_SETTLE_MS = 15_000;
const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;

/** Refuse, before any upload, a review the engine would refuse. */
export function assertReviewRequest(request: PipelineV3ReviewRequest): void {
  const { start } = request;
  const invalid = () => { throw new PipelineV3Error("invalid_request"); };
  if (start.pages.length < 1 || start.pages.length > PIPELINE_V3_LIMITS.maxPages
    || start.cachedReads.length > PIPELINE_V3_LIMITS.maxPages) {
    if (start.pages.length > PIPELINE_V3_LIMITS.maxPages) {
      throw new PipelineV3Error("too_large", { tooLarge: "book_chapters" }, tooManyChaptersMessage(PIPELINE_V3_LIMITS.maxPages));
    }
    invalid();
  }
  const ids = new Set(start.pages.map((page) => page.pageId));
  if (ids.size !== start.pages.length || !start.pages.some((page) => page.send === "whole")) invalid();
  if (start.scope === "full" && start.pages.some((page) => page.send !== "whole")) invalid();
  const whole = new Set(start.pages.filter((page) => page.send === "whole").map((page) => page.pageId));
  const passages = new Set(start.pages.filter((page) => page.send === "passages").map((page) => page.pageId));
  if (request.pages.length !== whole.size || request.pages.some((page) => !whole.has(page.pageId))
    || new Set(request.pages.map((page) => page.pageId)).size !== request.pages.length) invalid();
  if (request.passages.length !== passages.size || request.passages.some((entry) => !passages.has(entry.pageId))
    || new Set(request.passages.map((entry) => entry.pageId)).size !== request.passages.length) invalid();
  let bookChars = 0;
  for (const page of request.pages) {
    // runPipelineV3Review refuses these first, naming the chapter; this is the backstop before upload.
    const sizeLimit: ChapterSizeLimit | null = page.text.length > PIPELINE_V3_LIMITS.maxPageChars ? "chars"
      : estimatePipelineV3Tokens(page.text) > PIPELINE_V3_LIMITS.maxPageTokens ? "tokens" : null;
    if (sizeLimit) throw new PipelineV3Error("too_large", { pageId: page.pageId, tooLarge: "chapter", sizeLimit }, CHAPTER_TOO_LONG_MESSAGE);
    bookChars += page.text.length;
  }
  if (bookChars > PIPELINE_V3_LIMITS.maxBookChars) {
    // The limit in the book's own words: its word count scaled by the character limit's share.
    const words = request.pages.reduce((n, page) => n + countWords(page.text), 0);
    throw new PipelineV3Error("too_large", { tooLarge: "book_words" }, bookTooLargeMessage(Math.floor(words * (PIPELINE_V3_LIMITS.maxBookChars / bookChars))));
  }
  const contextTooLarge = () => new PipelineV3Error("too_large", { tooLarge: "context" }, CONTEXT_TOO_LARGE_MESSAGE);
  let passageChars = 0;
  for (const entry of request.passages) {
    if (entry.paragraphs.length > PIPELINE_V3_LIMITS.maxParagraphsPerPage) throw contextTooLarge();
    for (const paragraph of entry.paragraphs) {
      if (paragraph.text.length < 1 || paragraph.text.length > PIPELINE_V3_LIMITS.maxParagraphChars
        || paragraph.end - paragraph.start !== paragraph.text.length || paragraph.start < 0) invalid();
      passageChars += paragraph.text.length;
    }
  }
  if (passageChars > PIPELINE_V3_LIMITS.maxPassageChars) throw contextTooLarge();
  const frame = (type: string, payload: unknown) => Buffer.byteLength(JSON.stringify({ protocol: PIPELINE_V3_PROTOCOL, type, payload }), "utf8");
  if (frame("start", start) > PIPELINE_V3_LIMITS.maxFrameBytes || request.pages.some((page) => frame("page", page) > PIPELINE_V3_LIMITS.maxFrameBytes)
    || request.passages.some((entry) => frame("passages", entry) > PIPELINE_V3_LIMITS.maxFrameBytes)) throw contextTooLarge();
}

function admissionError(status: number): PipelineV3Error {
  if (status === 401 || status === 403) return new PipelineV3Error("unauthorized", { status });
  if (status === 402) return new PipelineV3Error("insufficient_credits", { status });
  if (status === 404) return new PipelineV3Error("unavailable", { status });
  if (status === 429) return new PipelineV3Error("rate_limited", { status });
  return new PipelineV3Error(status === 503 ? "unavailable" : "connection_lost", { status });
}

/** How long a health answer stands for status reads (mirrors EngineClient's HEALTH_CACHE_TTL_MS). */
export const PIPELINE_V3_HEALTH_CACHE_TTL_MS = 30_000;

export class PipelineV3Client {
  private healthCache: { at: number; value: PipelineV3Health } | null = null;
  /** An engine that does not serve v3 (404) says so for the cache lifetime too: status reads on an engine without v3 would
   *  otherwise make a round trip on every check. */
  private unavailableAt: number | null = null;
  private healthInFlight: Promise<PipelineV3Health> | null = null;

  constructor(private readonly transport: PipelineV3Transport, private readonly options: PipelineV3ClientOptions = {}) {}

  /**
   * Fresh read for reviews and checks: the engine's v3 policy, read policy and price. `unavailable`
   * when the engine does not serve v3. Its answer (or failure) replaces the status-read cache.
   */
  async health(): Promise<PipelineV3Health> {
    try {
      const value = await this.readHealth();
      this.healthCache = { at: Date.now(), value };
      this.unavailableAt = null;
      return value;
    } catch (error) {
      this.healthCache = null;
      this.unavailableAt = error instanceof PipelineV3Error && error.code === "unavailable" ? Date.now() : null;
      throw error;
    }
  }

  /** Status reads (Continuity tab coverage): the cached answer while younger than `maxAgeMs`, else one shared fresh read. */
  async cachedHealth(maxAgeMs: number = PIPELINE_V3_HEALTH_CACHE_TTL_MS): Promise<PipelineV3Health> {
    const cached = this.healthCache;
    if (cached && Date.now() - cached.at < maxAgeMs) return cached.value;
    if (this.unavailableAt !== null && Date.now() - this.unavailableAt < maxAgeMs) throw new PipelineV3Error("unavailable");
    if (!this.healthInFlight) {
      const pending = this.health().finally(() => { if (this.healthInFlight === pending) this.healthInFlight = null; });
      this.healthInFlight = pending;
    }
    return this.healthInFlight;
  }

  private async readHealth(): Promise<PipelineV3Health> {
    let answer: unknown;
    try {
      answer = await this.transport.getJson(PIPELINE_V3_HEALTH_ROUTE);
    } catch (error) {
      const status = (error as { status?: unknown } | null)?.status;
      if (status === 404) throw new PipelineV3Error("unavailable", { status });
      throw error;
    }
    try { return parsePipelineV3Health(answer); } catch { throw new PipelineV3Error("unavailable"); }
  }

  /**
   * Run one review. Resolves with the engine's result once every `onRead` callback has settled;
   * rejects with a PipelineV3Error. Aborting `signal` sends `cancel` and rejects as cancelled.
   */
  async review(request: PipelineV3ReviewRequest, callbacks: PipelineV3ReviewCallbacks = {}, signal?: AbortSignal): Promise<PipelineV3Result> {
    assertReviewRequest(request);
    if (signal?.aborted) throw new PipelineV3Error("cancelled");
    const url = new URL(`${this.transport.baseUrl.replace(/\/+$/u, "")}${PIPELINE_V3_REVIEW_ROUTE}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new PipelineV3Error("invalid_request");
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const headers = await this.transport.headers();
    if (signal?.aborted) throw new PipelineV3Error("cancelled");
    return this.connect(url.toString(), headers, request, callbacks, signal);
  }

  private connect(url: string, headers: Record<string, string>, request: PipelineV3ReviewRequest,
    callbacks: PipelineV3ReviewCallbacks, signal?: AbortSignal): Promise<PipelineV3Result> {
    const { logger } = this.transport;
    const { start } = request;
    const wholePages = new Map(start.pages.filter((page) => page.send === "whole").map((page) => [page.pageId, page.rev]));
    const idleMs = this.options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    const cancelSettleMs = this.options.cancelSettleMs ?? DEFAULT_CANCEL_SETTLE_MS;
    return new Promise<PipelineV3Result>((resolve, reject) => {
      const socket = new WebSocket(url, { headers, maxPayload: this.options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
        followRedirects: false, perMessageDeflate: false });
      let settled = false;
      let resultSeen = false;
      let cancelling = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let reads: Promise<void> = Promise.resolve();

      const finish = (error: PipelineV3Error | null, result?: PipelineV3Result) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        socket.removeAllListeners();
        socket.on("error", () => undefined);
        if (socket.readyState === WebSocket.OPEN) {
          socket.close(1000);
          const force = setTimeout(() => socket.terminate(), 1000);
          // Obsidian runs this in a renderer, where timers are DOM numbers without unref (plugin-side change).
          (force as { unref?: () => void }).unref?.();
          socket.once("close", () => clearTimeout(force));
        } else {
          socket.terminate();
        }
        if (error) {
          logger.warn("Pipeline v3 review stopped", { reviewId: start.reviewId, code: error.code, ...error.detail });
          reject(error);
        } else {
          resolve(result!);
        }
      };
      const touch = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => finish(new PipelineV3Error("timed_out")), idleMs);
        timer.unref?.();
      };
      const send = (type: PipelineV3ClientFrameType, payload?: unknown) => {
        socket.send(JSON.stringify({ protocol: PIPELINE_V3_PROTOCOL, type, ...(payload === undefined ? {} : { payload }) }), (error) => {
          if (error && !settled) finish(new PipelineV3Error("connection_lost"));
        });
      };
      /** A progress listener that throws (a closed window, say) must not escape the socket's event handler. */
      const notify = (what: string, run: () => void) => {
        try { run(); } catch (error) {
          logger.warn(`Pipeline v3 ${what} listener failed`, { reviewId: start.reviewId, error: error instanceof Error ? error.message : String(error) });
        }
      };
      /**
       * Cancel mid-review: the engine stops, settles the charge and then reports it in an `error` frame
       * (or a result that won the race), so the outcome is waited for rather than assumed.
       */
      function onAbort() {
        if (settled || cancelling) return;
        if (socket.readyState !== WebSocket.OPEN) return finish(new PipelineV3Error("cancelled"));
        cancelling = true;
        try { send("cancel"); } catch { return finish(new PipelineV3Error("cancelled")); }
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => finish(new PipelineV3Error("cancelled")), cancelSettleMs);
        timer.unref?.();
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      touch();

      socket.on("unexpected-response", (_req, response) => finish(admissionError(response.statusCode ?? 0)));
      socket.on("open", () => {
        touch();
        send("start", start);
        for (const page of request.pages) send("page", page);
        for (const entry of request.passages) send("passages", entry);
      });
      socket.on("message", (data: RawData, isBinary: boolean) => {
        if (settled || resultSeen) return;
        if (!cancelling) touch();
        const frame = isBinary ? null : parseServerFrame(data.toString());
        if (!frame) return finish(new PipelineV3Error("protocol_error"));
        switch (frame.type) {
          case "heartbeat": return;
          case "accepted":
            if (frame.payload.reviewId !== start.reviewId) return finish(new PipelineV3Error("protocol_error"));
            notify("accepted", () => callbacks.onAccepted?.(frame.payload));
            return;
          case "progress":
            notify("progress", () => callbacks.onProgress?.(frame.payload));
            return;
          case "read": {
            const read = frame.payload;
            if (!validChapterRead(read) || wholePages.get(read.pageId) !== read.rev) {
              logger.warn("Pipeline v3 chapter read skipped: outside the review or over the read schema", { reviewId: start.reviewId });
              return;
            }
            reads = reads.then(() => callbacks.onRead?.(read)).catch((error: unknown) => {
              logger.warn("Pipeline v3 chapter read could not be kept", { reviewId: start.reviewId, pageId: read.pageId,
                error: error instanceof Error ? error.message : String(error) });
            });
            return;
          }
          case "error": {
            const { code, message, charged } = frame.payload;
            return finish(new PipelineV3Error(code, charged === undefined ? {} : { charged }, message.trim() || undefined));
          }
          case "result": {
            const result = frame.payload;
            if (result.reviewId !== start.reviewId || result.policyId !== start.policyId) return finish(new PipelineV3Error("protocol_error"));
            resultSeen = true;
            if (timer) clearTimeout(timer);
            if (result.malformedIssues) logger.warn("Pipeline v3 malformed issues dropped", { reviewId: start.reviewId, count: result.malformedIssues });
            void reads.then(() => finish(null, result));
            return;
          }
        }
      });
      socket.on("close", (closeCode: number) => {
        if (!resultSeen) finish(new PipelineV3Error(cancelling ? "cancelled" : "connection_lost", { closeCode }));
      });
      socket.on("error", () => {
        if (!resultSeen) finish(new PipelineV3Error("connection_lost"));
      });
    });
  }
}
