# PackVerify — Real-time packing SOP verification with Newton

> Internship project at **[Archetype AI](https://archetype.ai)** — integrating Newton, Archetype's physical-world foundation model, into a live quality-assurance workflow for e-commerce fulfilment.

Drop a packing video. Newton watches it. Each step of the SOP ticks green (or red) in real time, in sync with the video playback, as soon as it's confirmed.

---

## Demo

https://github.com/user-attachments/assets/packing_box.mp4

> Upload `packing_box.mp4` (included in this repo) to see it working in mock mode — no API key needed.

---

## What it verifies

Six steps from the standard e-commerce packing SOP, in order:

| Step | Action |
|------|--------|
| 1 | **Add filler** — bubble wrap, packing peanuts, or cushioning material |
| 2 | **Place item in box** — product goes into the cardboard box |
| 3 | **Insert invoice slip** — Newton reads the slip text and matches it to the order SKU |
| 4 | **Seal box** — box is taped shut |
| 5 | **Apply shipping label** — barcode/address label adhered to the outside |
| 6 | **Place in delivery bin** — sealed box goes into the dispatch bin |

Steps reveal in real time as the video plays. A later step passing automatically marks any unconfirmed earlier step as failed (you can't seal a box that was never packed).

---

## Architecture

```
Browser (React + Vite)         Express backend             Archetype AI
        │                             │                          │
        │  1. POST /api/verify-file   │                          │
        ├───────────────────────────► │                          │
        │                             │  ffmpeg slices video     │
        │                             │  into 7-second segments  │
        │                             │                          │
        │                             │  K=3 bounded concurrency │
        │                             │  (earliest segments go   │
        │                             │   to Newton first)       │
        │                             │                          │
        │                             │  POST /v0.5/files ──────►│
        │                             │  POST /v0.5/query ──────►│
        │                             │◄─── Step N: PASS|FAIL ───│
        │                             │                          │
        │  2. SSE clip events         │                          │
        │◄────────────────────────────│                          │
        │                             │                          │
        │  3. Reveal gate (100ms tick)│                          │
        │     segment result held     │                          │
        │     until video.currentTime │                          │
        │     passes segmentEnd       │                          │
```

The key insight: Newton results arrive *before* the video plays to that part of the recording. Holding them in a buffer and revealing them as the video catches up makes the UI feel like Newton is watching the same video the operator is, in real time.

---

## Engineering highlights

### K=3 bounded concurrency pipeline

All segments are submitted to Newton in parallel, but bounded to 3 in-flight calls at a time, *always starting from the earliest segment*. This means segment 0 (0–7s) always returns before segment 3 (21–28s), so step verdicts arrive in the order the actions happened.

```js
// backend/server.js
const CONCURRENCY = 3;
let nextIdx = 0, completedCount = 0;

function startNext() {
  while (nextIdx < segments.length && (nextIdx - completedCount) < CONCURRENCY) {
    const seg = segments[nextIdx++];
    processSegment(seg).finally(() => {
      completedCount++;
      startNext(); // a slot freed — pull the next earliest segment
    });
  }
}
```

A naive `Promise.all` would submit all segments simultaneously; Newton's load-balancing means the last segment can return first, causing step 6 to light up before step 1. The bounded pipeline prevents this.

### Reveal gate synced to video playback

Newton results are held in a buffer keyed by segment index. A 100ms tick checks `video.currentTime` against each buffered result's `segmentEnd`. A verdict is only applied to the UI once the video has played past the end of the window where the action was detected:

```js
// frontend/src/lib/useNewtonSession.js
const toReveal = Object.values(pending).filter(r => r.segmentEnd <= videoTime);
```

This prevents steps from lighting up before the operator has seen the action on screen.

### Order-aware fail inference

If Newton confirms step 4 (seal box), steps 1–3 must have happened. Any earlier step still marked *pending* at that point gets a red cross — it was either missed or happened off-camera:

```js
// frontend/src/lib/parseNewton.js
export function inferFailsFromOrder(stepState) {
  const highestPassed = Math.max(...passedIds);
  for (let i = 1; i < highestPassed; i++) {
    if (stepState[i]?.status !== "pass") {
      stepState[i] = { ...stepState[i], status: "fail" };
    }
  }
  return stepState;
}
```

Additionally, if the video ends and the final step was never confirmed, it is automatically marked failed — a video that ends at the sealing step couldn't have placed the box in the bin.

### Server-Sent Events for streaming results

The backend streams each segment result to the browser as it arrives from Newton — no polling, no waiting for all segments to finish. The frontend applies verdicts incrementally:

```
event: clip
data: {"clipIndex":2,"raw":"Step 1: PASS ... | Step 2: PASS ...","segmentStart":14,"segmentEnd":21}
```

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| AI model | [Newton](https://archetype.ai) (Archetype AI's physical-world VLM) |
| Backend | Node.js, Express, Server-Sent Events |
| Video processing | ffmpeg (7-second segment slicing) |
| Frontend | React 18, Vite |
| Styling | Vanilla CSS — custom properties, CSS Grid |

---

## Running locally

The app runs in **mock mode** out of the box — Newton responses are simulated with realistic timing so the full UI works without an API key.

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env   # ATAI_MODE=mock by default — no key needed
npm run dev            # → http://localhost:8787
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev            # → http://localhost:5173
```

Open [http://localhost:5173](http://localhost:5173), fill in a product name and SKU, drop a video, and click **Verify video**.

The included `packing_box.mp4` is a good test clip — it runs through the full packing SOP.

---

## Going live with Newton

1. Get an API key from [Archetype AI](https://archetype.ai).
2. Edit `backend/.env`:
   ```
   ATAI_API_KEY=your_key_here
   ATAI_MODE=live
   ```
3. Restart the backend. It will now upload each video segment to Newton and return real verdicts.

> **Note:** `backend/.env` is listed in both `.gitignore` and `.claudeignore` and is never committed or read by AI tools.

---

## Project structure

```
task-verification/
├── backend/
│   ├── server.js        Express API: session lifecycle, segment pipeline, SSE
│   ├── newton.js        Newton integration: upload + query, mock mode
│   └── .env.example     Copy to .env and add your key
├── frontend/
│   └── src/
│       ├── App.jsx                   Root: session state, overlay layout
│       ├── components/
│       │   ├── StartScreen.jsx       Upload dropzone + order form
│       │   ├── InstructionsPanel.jsx SOP checklist with live step status
│       │   └── NewtonStatusPanel.jsx Activity log + progress indicator
│       ├── lib/
│       │   ├── useNewtonSession.js   Session hook: SSE, reveal gate, tick
│       │   └── parseNewton.js        Newton response parser + fail inference
│       └── config/
│           └── steps.js              SOP step definitions
└── packing_box.mp4      Demo video
```

---

*Built during an internship at [Archetype AI](https://archetype.ai), 2025.*
