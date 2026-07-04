import { useState } from "react";
import { STEPS } from "../config/steps.js";

// Left floating panel: the SOP checklist.
// Each step shows a status node on a vertical timeline, the step name + subtitle,
// and a collapsible dropdown holding Newton's reasoning per observation.
export default function InstructionsPanel({ stepState, product, sku }) {
  return (
    <section className="panel instructions" aria-label="Packing steps">
      <header className="panel-eyebrow">Instructions</header>

      {product && (
        <div className="order-chip">
          <span className="order-label">Order</span>
          <span className="order-value">{product}</span>
          <span className="order-sku">SKU {sku}</span>
        </div>
      )}

      <ol className="timeline">
        {STEPS.map((step, i) => (
          <StepRow
            key={step.id}
            step={step}
            state={stepState[step.id]}
            isLast={i === STEPS.length - 1}
          />
        ))}
      </ol>
    </section>
  );
}

function StepRow({ step, state, isLast }) {
  const [open, setOpen] = useState(false);
  const status = state?.status || "pending";
  const observations = state?.observations || [];
  const hasDetail = observations.length > 0;

  return (
    <li className={`step status-${status}`}>
      {!isLast && <span className={`connector ${status === "pass" ? "filled" : status === "fail" ? "filled-fail" : ""}`} />}

      <span className={`node node-${status}`}>
        {status === "pass" ? (
          <i className="ti ti-check" aria-hidden="true" />
        ) : status === "fail" ? (
          <i className="ti ti-x" aria-hidden="true" />
        ) : (
          <span className="node-num">{step.id}</span>
        )}
      </span>

      <div className="step-body">
        <button
          className="step-head"
          onClick={() => hasDetail && setOpen((o) => !o)}
          aria-expanded={open}
          disabled={!hasDetail}
        >
          <span className="step-name">{step.name}</span>
          {hasDetail && (
            <i
              className={`ti ti-chevron-down chev ${open ? "open" : ""}`}
              aria-hidden="true"
            />
          )}
        </button>
        <p className="step-sub">{step.subtitle}</p>

        {open && (
          <div className="step-detail">
            {observations.map((o, idx) => (
              <div key={idx} className={`obs obs-${o.verdict.toLowerCase()}`}>
                <span className="obs-tag">
                  {o.verdict} · clip {o.clipIndex}
                </span>
                {o.reason && <span className="obs-reason">{o.reason}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}
