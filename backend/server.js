// server.js
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import "dotenv/config";

import { verifyClip, getMode, isReady } from "./newton.js";

const execAsync = promisify(exec);
const PORT = process.env.PORT || 8787;
const SEGMENT_SECS = 7; // 7s windows — enough context for any packing action, short enough for near-real-time feedback

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: path.join(os.tmpdir(), "newton-clips") });

let session = null;

function newSession({ product, sku }) {
  return {
    id: `lsn-${Date.now().toString(36)}`,
    startedAt: Date.now(),
    product,
    sku,
    clipIndex: 0,
    sseClients: new Set(),
    queueWaiting: 0,
    processing: 0,
  };
}

function buildFocus({ product, sku }) {
  return [
    "Check which of the following steps are visible and being performed correctly in this video clip:",
    "Step 1: Add filler — add bubble wrap, tissue paper, packing peanuts, or any protective cushioning material into the box.",
    "Step 2: Place item in box — place the product into the cardboard box.",
    `Step 3: Insert invoice slip — place the printed invoice slip inside the box. Read any text visible on the slip and confirm it matches the order: ${product} SKU:${sku}.`,
    "Step 4: Seal box — seal the box shut with tape.",
    "Step 5: Apply shipping label — attach a shipping label (containing a barcode, tracking number, or delivery address) onto the outside surface of the sealed box. This may also be called a dispatch label or address label. Look for any sticker being pressed onto the box exterior.",
    "Step 6: Place in bin — place the sealed box into the delivery or dispatch bin.",
    "Use both what you see and any audio cues (spoken words, scanner beeps, confirmation sounds) in the recording.",
    "For each step report: Step N: PASS or FAIL — one sentence reason.",
    "Separate each step result with |. If a step is not visible or audible, report Step N: NONE.",
  ].join("\n");
}

function broadcast(type, payload) {
  if (!session) return;
  const frame = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of session.sseClients) res.write(frame);
}

// Returns video duration in seconds, or null if ffprobe isn't available.
async function getVideoDuration(filePath) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -print_format json -show_format "${filePath}"`
    );
    const dur = parseFloat(JSON.parse(stdout).format.duration);
    return isNaN(dur) ? null : dur;
  } catch {
    return null;
  }
}

// Slice [startSec, startSec+durationSec) out of inputPath into outputPath.
async function sliceSegment(inputPath, outputPath, startSec, durationSec) {
  await execAsync(
    `ffmpeg -ss ${startSec} -i "${inputPath}" -t ${durationSec} -c copy -avoid_negative_ts make_zero -y "${outputPath}" 2>/dev/null`
  );
}

// --- Health ---------------------------------------------------------------
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, mode: getMode(), ready: isReady() });
});

// --- Start a session ------------------------------------------------------
app.post("/api/session/start", (req, res) => {
  const product = req.body?.product?.trim() || "Unknown product";
  const sku = req.body?.sku?.trim() || "N/A";
  session = newSession({ product, sku });
  res.json({ sessionId: session.id, mode: getMode(), product, sku });
});

// --- SSE stream ------------------------------------------------------------
app.get("/api/events", (req, res) => {
  if (!session) {
    res.status(409).json({ error: "No active session. Start one first." });
    return;
  }
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  res.write(`event: ready\ndata: ${JSON.stringify({ sessionId: session.id })}\n\n`);
  session.sseClients.add(res);
  req.on("close", () => session?.sseClients.delete(res));
});

// --- Live webcam clip ------------------------------------------------------
app.post("/api/clip", upload.single("clip"), async (req, res) => {
  if (!session) {
    res.status(409).json({ error: "No active session." });
    return;
  }
  const clipIndex = session.clipIndex++;
  const filePath = req.file?.path;
  res.json({ accepted: true, clipIndex });

  session.processing++;
  broadcast("log", { text: `RECORDING… clip ${clipIndex} received` });
  broadcast("status", {
    state: "analyzing",
    queueWaiting: session.queueWaiting,
    processing: session.processing,
  });

  try {
    const focus = buildFocus(session);
    const t0 = Date.now();
    const raw = await verifyClip({ filePath, focus, clipIndex, mimeType: req.file.mimetype });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    broadcast("clip", { clipIndex, raw, seconds: secs });
    broadcast("log", { text: `Clip ${clipIndex} done — ${secs}s` });
  } catch (err) {
    broadcast("log", { text: `Clip ${clipIndex} error — ${err.message}` });
    broadcast("error", { clipIndex, message: err.message });
  } finally {
    session.processing--;
    broadcast("status", {
      state: session.processing > 0 ? "analyzing" : "idle",
      queueWaiting: session.queueWaiting,
      processing: session.processing,
    });
    if (filePath) fs.unlink(filePath, () => {});
  }
});

// --- Verify a pre-recorded video ------------------------------------------
// In live mode: slice into SEGMENT_SECS-second segments, submit all to Newton
// in parallel, and broadcast each result as it arrives with segmentStart/End
// so the frontend can gate reveals to video playback position.
// In mock mode: walk the 6-step script progressively (UI demo).
app.post("/api/verify-file", upload.single("video"), async (req, res) => {
  if (!session) {
    res.status(409).json({ error: "No active session." });
    return;
  }
  const filePath = req.file?.path;
  const mimeType = req.file?.mimetype;
  res.json({ accepted: true });

  const focus = buildFocus(session);
  broadcast("log", { text: "Uploaded video received — analyzing" });
  broadcast("status", { state: "analyzing", queueWaiting: 0, processing: 1 });

  try {
    if (getMode() === "mock") {
      for (let i = 0; i < 6; i++) {
        const t0 = Date.now();
        const raw = await verifyClip({ filePath, focus, clipIndex: i, mimeType });
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        const segStart = i * SEGMENT_SECS;
        broadcast("clip", {
          clipIndex: i,
          raw,
          seconds: secs,
          segmentStart: segStart,
          segmentEnd: segStart + SEGMENT_SECS,
        });
        broadcast("log", { text: `Segment ${i} (${segStart}s–${segStart + SEGMENT_SECS}s) — ${secs}s` });
      }
    } else {
      // Detect video duration; fall back to single-query if ffprobe unavailable.
      const duration = await getVideoDuration(filePath);
      if (!duration) {
        // ffprobe not available — single query fallback
        const t0 = Date.now();
        const raw = await verifyClip({ filePath, focus, clipIndex: 0, mimeType });
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        broadcast("clip", { clipIndex: 0, raw, seconds: secs });
        broadcast("log", { text: `Video analyzed — ${secs}s` });
      } else {
        const numSegments = Math.ceil(duration / SEGMENT_SECS);
        broadcast("log", { text: `${numSegments} segments × ${SEGMENT_SECS}s — starting` });
        broadcast("status", { state: "analyzing", queueWaiting: numSegments, processing: 0 });

        const segDir = fs.mkdtempSync(path.join(os.tmpdir(), "newton-segs-"));
        const segments = Array.from({ length: numSegments }, (_, i) => ({
          index: i,
          start: i * SEGMENT_SECS,
          end: Math.min((i + 1) * SEGMENT_SECS, duration),
          segPath: path.join(segDir, `seg-${i}.mp4`),
        }));

        // Bounded concurrency: process 3 segments at a time, strictly in order
        // (seg 0 → 1 → 2 first, then 3 as slots free). This guarantees Newton
        // always works on the earliest-in-video content first, so step reveals
        // track what the user is actually watching.
        const CONCURRENCY = 3;
        let nextIdx = 0;
        let completedCount = 0;

        async function processSegment(seg) {
          try {
            await sliceSegment(filePath, seg.segPath, seg.start, SEGMENT_SECS);
          } catch (sliceErr) {
            broadcast("log", { text: `Slice ${seg.index} error — ${sliceErr.message}` });
            return;
          }
          const t0 = Date.now();
          try {
            const raw = await verifyClip({
              filePath: seg.segPath,
              focus,
              clipIndex: seg.index,
              mimeType: "video/mp4",
              maxFrames: 16,
            });
            const secs = ((Date.now() - t0) / 1000).toFixed(1);
            broadcast("clip", {
              clipIndex: seg.index,
              raw,
              seconds: secs,
              segmentStart: seg.start,
              segmentEnd: seg.end,
            });
            broadcast("log", { text: `${seg.start}s–${seg.end.toFixed(0)}s ready (${secs}s)` });
          } catch (err) {
            broadcast("log", { text: `Segment ${seg.index} error — ${err.message}` });
            broadcast("error", { clipIndex: seg.index, message: err.message });
          } finally {
            fs.unlink(seg.segPath, () => {});
          }
        }

        await new Promise((resolveAll) => {
          function startNext() {
            // Fill slots up to CONCURRENCY, always picking the next unstarted segment.
            while (nextIdx < segments.length && (nextIdx - completedCount) < CONCURRENCY) {
              const seg = segments[nextIdx++];
              processSegment(seg).finally(() => {
                completedCount++;
                broadcast("status", {
                  state: "analyzing",
                  queueWaiting: Math.max(0, segments.length - nextIdx),
                  processing: nextIdx - completedCount,
                });
                if (completedCount === segments.length) {
                  resolveAll();
                } else {
                  startNext(); // a slot freed — pull the next segment in
                }
              });
            }
          }
          startNext();
        });

        fs.rm(segDir, { recursive: true, force: true }, () => {});
      }
    }

    broadcast("done", { sessionId: session.id });
    broadcast("status", { state: "done", queueWaiting: 0, processing: 0 });
  } catch (err) {
    broadcast("log", { text: `Video error — ${err.message}` });
    broadcast("error", { message: err.message });
    broadcast("status", { state: "idle", queueWaiting: 0, processing: 0 });
  } finally {
    if (filePath) fs.unlink(filePath, () => {});
  }
});

// --- Stop the session -----------------------------------------------------
app.post("/api/session/stop", (_req, res) => {
  if (session) {
    broadcast("done", { sessionId: session.id });
    for (const client of session.sseClients) client.end();
    session = null;
  }
  res.json({ stopped: true });
});

app.listen(PORT, () => {
  console.log(`Newton backend on http://localhost:${PORT}  (mode: ${getMode()})`);
  if (getMode() === "live" && !isReady()) {
    console.warn("WARNING: ATAI_MODE=live but ATAI_API_KEY is empty.");
  }
});
