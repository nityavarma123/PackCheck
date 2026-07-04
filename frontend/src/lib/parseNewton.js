// parseNewton.js
// Newton returns all steps in one pipe-separated line per clip, e.g.
//   "Step 1: PASS — item placed | Step 2: NONE | Step 3: FAIL — no slip visible"
// This turns that into structured verdicts the UI can apply.

// Returns: [{ step: 1, verdict: "PASS"|"FAIL"|"NONE", reason: "…" }, ...]
export function parseNewton(raw) {
  if (!raw || typeof raw !== "string") return [];

  return raw
    .split("|")
    .map((chunk) => chunk.trim())
    .map(parseOne)
    .filter(Boolean);
}

function parseOne(chunk) {
  // Match "Step 3: PASS — reason"  (em dash, en dash, or hyphen all accepted)
  const m = chunk.match(/step\s*(\d+)\s*[:\-]?\s*(PASS|FAIL|NONE)\s*[—–-]?\s*(.*)/i);
  if (!m) return null;

  const step = parseInt(m[1], 10);
  const verdict = m[2].toUpperCase();
  const reason = (m[3] || "").trim();
  return { step, verdict, reason };
}

// Apply a clip's verdicts to the running step state.
// Rule: the first PASS for a step locks it green. A FAIL is recorded only if the
// step hasn't already passed. Every observation is kept for the dropdown.
export function applyVerdicts(prevState, verdicts, clipIndex) {
  const next = { ...prevState };

  for (const v of verdicts) {
    if (v.verdict === "NONE") continue;

    const current = next[v.step] || {
      status: "pending",
      reason: "",
      observations: [],
    };

    const observation = {
      clipIndex,
      verdict: v.verdict,
      reason: v.reason,
    };

    const alreadyPassed = current.status === "pass";

    next[v.step] = {
      ...current,
      // First PASS wins and locks the step. Otherwise reflect the latest verdict
      // unless we've already passed.
      status: alreadyPassed ? "pass" : v.verdict === "PASS" ? "pass" : "fail",
      reason: alreadyPassed ? current.reason : v.reason || current.reason,
      observations: [...current.observations, observation],
    };
  }

  return next;
}

export function emptyStepState(steps) {
  const state = {};
  for (const s of steps) {
    state[s.id] = { status: "pending", reason: "", observations: [] };
  }
  return state;
}

// If a later step has passed, any earlier step that isn't passed must have been
// skipped — mark it fail so the timeline stays coherent.
export function inferFailsFromOrder(stepState) {
  const passedIds = Object.entries(stepState)
    .filter(([, s]) => s.status === "pass")
    .map(([id]) => parseInt(id, 10));

  if (passedIds.length === 0) return stepState;

  const highestPassed = Math.max(...passedIds);
  const next = { ...stepState };

  for (let i = 1; i < highestPassed; i++) {
    const s = next[i];
    if (s && s.status !== "pass") {
      next[i] = {
        ...s,
        status: "fail",
        reason: s.reason || "Not confirmed before a later step passed.",
      };
    }
  }

  return next;
}

