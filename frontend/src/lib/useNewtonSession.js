// useNewtonSession.js
// Session lifecycle for file-based Newton verification.
// Video plays immediately; Newton analyzes in parallel; step verdicts reveal
// as the video reaches the end of each segment they were detected in.

import { useCallback, useEffect, useRef, useState } from "react";
import { BACKEND, STEPS } from "../config/steps.js";
import {
  applyVerdicts,
  emptyStepState,
  inferFailsFromOrder,
  parseNewton,
} from "./parseNewton.js";

export function useNewtonSession() {
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState("mock");
  const [videoPaused, setVideoPaused] = useState(false);
  const [videoStarted, setVideoStarted] = useState(false);
  const [status, setStatus] = useState({ state: "idle", queueWaiting: 0, processing: 0 });
  const [stepState, setStepState] = useState(() => emptyStepState(STEPS));
  const [log, setLog] = useState([]);
  const [elapsed, setElapsed] = useState(0);

  const videoRef = useRef(null);
  const sseRef = useRef(null);
  const elapsedTimerRef = useRef(null);
  const startTsRef = useRef(0);
  // Buffer segment results until the video plays past each segment's end time.
  const pendingSegmentsRef = useRef({});
  // Coordinate shutdown: only close once BOTH video and Newton are done.
  const newtonDoneRef = useRef(false);
  const videoEndedRef = useRef(false);

  const pushLog = useCallback((text) => {
    const ts = formatClock((Date.now() - startTsRef.current) / 1000);
    setLog((prev) => [...prev, { ts, text }].slice(-60));
  }, []);

  const toggleVideoPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
      setVideoPaused(false);
    } else {
      video.pause();
      setVideoPaused(true);
    }
  }, []);

  // --- start from a pre-recorded video -------------------------------------
  const startFromFile = useCallback(
    async ({ product, sku, file }) => {
      // 1. start a backend session
      const r = await fetch(`${BACKEND}/api/session/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product, sku }),
      });
      const meta = await r.json();
      setMode(meta.mode);

      // 2. reset state
      setStepState(emptyStepState(STEPS));
      setLog([]);
      pendingSegmentsRef.current = {};
      newtonDoneRef.current = false;
      videoEndedRef.current = false;
      startTsRef.current = Date.now();
      setElapsed(0);
      setRunning(true);
      setVideoPaused(false);
      setVideoStarted(true);

      // 3. Play the video immediately — Newton analyzes in parallel.
      if (videoRef.current) {
        videoRef.current.autoplay = false;
        videoRef.current.srcObject = null;
        videoRef.current.src = URL.createObjectURL(file);
        videoRef.current.loop = false;
        videoRef.current.play().catch(() => {});

        videoRef.current.addEventListener("ended", () => {
          videoEndedRef.current = true;
          flushPending();
          if (newtonDoneRef.current) {
            clearInterval(elapsedTimerRef.current);
            setVideoStarted(false);
            setRunning(false);
          }
        }, { once: true });
      }

      // 4. Open SSE before uploading so no events are missed.
      const sse = new EventSource(`${BACKEND}/api/events`);
      sseRef.current = sse;

      const sseReady = new Promise((resolve) => {
        sse.addEventListener("ready", resolve, { once: true });
        setTimeout(resolve, 2000);
      });

      sse.addEventListener("status", (e) => setStatus(JSON.parse(e.data)));
      sse.addEventListener("log", (e) => pushLog(JSON.parse(e.data).text));

      sse.addEventListener("clip", (e) => {
        const { raw, clipIndex, segmentStart, segmentEnd } = JSON.parse(e.data);
        if (segmentEnd !== undefined) {
          // Hold in buffer; tick reveals it once video passes segmentEnd.
          pendingSegmentsRef.current[clipIndex] = { raw, clipIndex, segmentStart, segmentEnd };
        } else {
          const verdicts = parseNewton(raw);
          setStepState((prev) => inferFailsFromOrder(applyVerdicts(prev, verdicts, clipIndex)));
        }
      });

      sse.addEventListener("done", () => {
        newtonDoneRef.current = true;
        pushLog("Newton analysis complete");
        if (videoEndedRef.current) {
          flushPending();
          clearInterval(elapsedTimerRef.current);
          setVideoStarted(false);
          setRunning(false);
        }
      });
      sse.onerror = () => {};

      // 5. 100ms tick: reveal buffered segments once the video has played past them.
      //    K=3 concurrency ensures earlier segments always return first, so the gap
      //    between the action on screen and the tick is at most one 7-second window.
      elapsedTimerRef.current = setInterval(() => {
        setElapsed((Date.now() - startTsRef.current) / 1000);

        const pending = pendingSegmentsRef.current;
        if (Object.keys(pending).length === 0) return;

        const videoTime = videoRef.current?.currentTime ?? Infinity;
        const toReveal = Object.values(pending).filter((r) => r.segmentEnd <= videoTime);
        if (toReveal.length === 0) return;

        toReveal.sort((a, b) => a.clipIndex - b.clipIndex);
        for (const result of toReveal) {
          delete pending[result.clipIndex];
          const verdicts = parseNewton(result.raw);
          setStepState((prev) => inferFailsFromOrder(applyVerdicts(prev, verdicts, result.clipIndex)));
          const confirmed = verdicts.filter((v) => v.verdict !== "NONE");
          const summary = confirmed.length
            ? confirmed.map((v) => `Step ${v.step}: ${v.verdict}`).join(" | ")
            : "no steps detected";
          pushLog(`${result.segmentStart}s–${result.segmentEnd?.toFixed(0)}s → ${summary}`);
        }
      }, 100);

      await sseReady;

      // 6. Upload the whole video — backend slices and submits to Newton in parallel.
      const form = new FormData();
      form.append("video", file, file.name);
      try {
        await fetch(`${BACKEND}/api/verify-file`, { method: "POST", body: form });
      } catch {
        pushLog("Failed to upload video to backend");
      }
    },
    [pushLog]
  );

  // Apply all buffered Newton results immediately (called when video or Newton finishes).
  function flushPending() {
    const pending = pendingSegmentsRef.current;
    const remaining = Object.values(pending).sort((a, b) => a.clipIndex - b.clipIndex);
    for (const result of remaining) {
      delete pending[result.clipIndex];
      const verdicts = parseNewton(result.raw);
      setStepState((prev) => inferFailsFromOrder(applyVerdicts(prev, verdicts, result.clipIndex)));
    }
    pendingSegmentsRef.current = {};

    // If both parties are done, mark the last step fail if it never appeared —
    // a video that ended without placing the box in the bin couldn't have done it.
    if (videoEndedRef.current && newtonDoneRef.current) {
      const lastId = STEPS[STEPS.length - 1].id;
      setStepState((prev) => {
        const s = prev[lastId];
        if (s && s.status === "pending") {
          return {
            ...prev,
            [lastId]: { ...s, status: "fail", reason: "Video ended before this step was completed." },
          };
        }
        return prev;
      });
    }
  }

  // --- stop -----------------------------------------------------------------
  const stop = useCallback(async () => {
    clearInterval(elapsedTimerRef.current);
    sseRef.current?.close();
    if (videoRef.current) {
      const blobUrl = videoRef.current.src;
      videoRef.current.pause();
      videoRef.current.src = "";
      if (blobUrl.startsWith("blob:")) URL.revokeObjectURL(blobUrl);
    }
    pendingSegmentsRef.current = {};
    newtonDoneRef.current = false;
    videoEndedRef.current = false;
    setRunning(false);
    setVideoPaused(false);
    setVideoStarted(false);
    setStatus((s) => ({ ...s, state: "done" }));
    try {
      await fetch(`${BACKEND}/api/session/stop`, { method: "POST" });
    } catch {
      // backend may already be gone
    }
  }, []);

  useEffect(() => () => stop(), [stop]);

  const passed = Object.values(stepState).filter((s) => s.status === "pass").length;

  return {
    running,
    mode,
    videoPaused,
    videoStarted,
    toggleVideoPause,
    status,
    stepState,
    log,
    elapsed,
    passed,
    total: STEPS.length,
    videoRef,
    startFromFile,
    stop,
  };
}

export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}
