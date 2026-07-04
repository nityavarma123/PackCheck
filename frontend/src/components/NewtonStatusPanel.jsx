import { useEffect, useRef } from "react";
import { formatClock } from "../lib/useNewtonSession.js";

// Right floating panel: Newton's live state + the raw activity log.
export default function NewtonStatusPanel({ status, log, elapsed, passed, total, done }) {
  const state = done ? "done" : status.state;
  const label = stateLabel(state, status);

  return (
    <aside className="panel newton" aria-label="Newton status and activity log">
      <div className="newton-status">
        <header className="panel-eyebrow">Newton status</header>
        <div className="status-row">
          <span className={`dot dot-${state}`} aria-hidden="true" />
          <span className="status-label">{label}</span>
          <span className="status-time">{formatClock(elapsed)}</span>
        </div>
        {(state === "done" || passed > 0) && (
          <div className="status-summary">
            {passed}/{total} steps passed
          </div>
        )}
      </div>

      <ActivityLog log={log} />
    </aside>
  );
}

function stateLabel(state, status) {
  if (state === "done") return "Done";
  if (state === "analyzing") {
    const queued = status.queueWaiting > 0 ? ` (+${status.queueWaiting} queued)` : "";
    return `Analyzing${queued}`;
  }
  return "Idle";
}

function ActivityLog({ log }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [log]);

  return (
    <div className="activity">
      <header className="panel-eyebrow">Activity log</header>
      <div className="activity-scroll" ref={ref}>
        {log.length === 0 && <p className="activity-empty">Waiting for clips…</p>}
        {log.map((entry, i) => (
          <div className="activity-line" key={i}>
            <span className="activity-ts">{entry.ts}</span>
            <span className="activity-text">{entry.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
