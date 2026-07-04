// newton.js
// The ONLY file that talks to Newton. Everything Newton-specific lives here so
// the rest of the backend never sees the API key or the request shapes.
//
// Two modes, set by ATAI_MODE in .env:
//   mock -> returns realistic faked verdicts so the UI works with no key
//   live -> uploads each clip to Newton and uses the real verdicts
//
// LIVE MODE: confirm UPLOAD_URL and QUERY_URL below against your Archetype
// console / docs. The request shapes follow the documented pattern, but the
// exact paths can differ per account, so verify before relying on them.

import fs from "node:fs";

const MODE = process.env.ATAI_MODE === "live" ? "live" : "mock";
const API_KEY = process.env.ATAI_API_KEY || "";

const API_BASE = "https://api.u1.archetypeai.app";
const UPLOAD_URL = `${API_BASE}/v0.5/files`;     // multipart file upload
const QUERY_URL = `${API_BASE}/v0.5/query`;      // stateless query over an uploaded clip
const MODEL = "Newton::c2_4_7b_251215a172f6d7";

// The instruction framing Newton sees. The per-order focus prompt (with the
// expected product) is built in server.js and passed in as `focus`.
const INSTRUCTION =
  "You are an e-commerce packing quality inspector. Watch the video and listen to any audio " +
  "(spoken words, scanner beeps, confirmation sounds, alerts). Use both visual and audio evidence " +
  "to determine which packing steps are visible and whether each is performed correctly.";

export function getMode() {
  return MODE;
}

export function isReady() {
  return MODE === "mock" || API_KEY.length > 0;
}

// Verify one clip against the SOP.
// Returns the raw Newton text, e.g.
//   "Step 1: PASS — item placed in box | Step 2: NONE | Step 3: FAIL — no slip visible"
export async function verifyClip({ filePath, focus, clipIndex, mimeType = "video/mp4", maxFrames = 16 }) {
  if (MODE === "mock") {
    return mockVerify({ focus, clipIndex });
  }
  return liveVerify({ filePath, focus, mimeType, maxFrames });
}

// ---------------------------------------------------------------------------
// LIVE MODE
// ---------------------------------------------------------------------------

async function liveVerify({ filePath, focus, mimeType, maxFrames }) {
  if (!API_KEY) throw new Error("ATAI_API_KEY is missing but ATAI_MODE=live");

  // 1. Upload the clip; get back the file_id Newton assigned.
  const fileId = await uploadClip(filePath, mimeType);

  // 2. Query Newton over that clip.
  const res = await fetch(QUERY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: focus,
      instruction_prompt: INSTRUCTION,
      file_ids: [fileId],
      model: MODEL,
      max_frames: maxFrames,
      max_new_tokens: 512,
      do_sample: false,
      temperature: 0.0,
    }),
    // Newton video calls can be slow; give it room.
    signal: AbortSignal.timeout(600_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Newton query failed: ${res.status} ${detail}`);
  }

  const data = await res.json();
  // Response shape: { response: { response: ["...text..."] } }
  const text =
    data?.response?.response?.[0] ??
    data?.response ??
    JSON.stringify(data);
  return typeof text === "string" ? text : JSON.stringify(text);
}

async function uploadClip(filePath, mimeType) {
  const buffer = fs.readFileSync(filePath);
  const blob = new Blob([buffer], { type: mimeType });
  const form = new FormData();
  const ext = mimeType === "video/quicktime" ? ".mp4" : `.${mimeType.split("/")[1]}`;
  const fileName = filePath.split("/").pop() + ext;
  form.append("file", blob, fileName);

  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Newton upload failed: ${res.status} ${detail}`);
  }
  await res.json(); // consume body; we don't use the upload uid
  // IMPORTANT: file_ids in the query uses the FILENAME (e.g. "clip.mp4"),
  // NOT the uid returned by the upload response — passing the uid causes 400.
  return fileName;
}

// ---------------------------------------------------------------------------
// MOCK MODE
// ---------------------------------------------------------------------------

// Simulates a packing run progressing through the 6 steps over successive clips.
// Each clip "advances" through the SOP so you can watch the checklist fill in.
function mockVerify({ clipIndex }) {
  const script = [
    "Step 1: PASS — Bubble wrap added to box. | Step 2: NONE | Step 3: NONE | Step 4: NONE | Step 5: NONE | Step 6: NONE",
    "Step 1: PASS — Filler in place. | Step 2: PASS — Product placed into the cardboard box. | Step 3: NONE | Step 4: NONE | Step 5: NONE | Step 6: NONE",
    "Step 2: PASS — Item sits in the box. | Step 3: PASS — Invoice slip inserted; reads SoundWave Pro headphones SKU SW-1042, matches the order. | Step 4: NONE | Step 5: NONE | Step 6: NONE",
    "Step 3: PASS — Slip visible inside box. | Step 4: PASS — Box sealed shut with tape. | Step 5: NONE | Step 6: NONE",
    "Step 4: PASS — Box taped. | Step 5: PASS — Shipping label applied to the outside of the box. | Step 6: NONE",
    "Step 5: PASS — Label on box. | Step 6: PASS — Sealed box placed into the delivery bin.",
  ];
  const line = script[Math.min(clipIndex, script.length - 1)];
  // Simulate Newton latency.
  const delay = 1200 + Math.random() * 900;
  return new Promise((resolve) => setTimeout(() => resolve(line), delay));
}
