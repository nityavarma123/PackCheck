import { useRef, useState } from "react";

export default function StartScreen({ onStartFile, mode }) {
  const [product, setProduct] = useState("SoundWave Pro headphones");
  const [sku, setSku] = useState("SW-1042");
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef(null);

  function pickFile(f) {
    if (f && (f.type === "video/mp4" || f.type === "video/quicktime")) {
      setFile(f);
      setErr("");
    } else if (f) {
      setErr("Unsupported format. Please upload an MP4 or MOV file.");
    }
  }

  async function handleStart() {
    if (!file) {
      setErr("Drop a video first.");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      await onStartFile({ product, sku, file });
    } catch (e) {
      setErr(e?.message || "Could not start the session.");
      setBusy(false);
    }
  }

  return (
    <div className="start-screen">
      <div className="start-card">
        <div className="start-top">
          <span className="brand-mark">Task Verification</span>
          <span className={`mode-pill mode-${mode}`}>{mode}</span>
        </div>

        <p className="start-lede">
          Newton checks each packing step against the order and flags anything
          missed — in real time, as the video plays.
        </p>

        <div className="field-row">
          <label className="field">
            <span>Product</span>
            <input value={product} onChange={(e) => setProduct(e.target.value)} />
          </label>
          <label className="field sku">
            <span>SKU</span>
            <input value={sku} onChange={(e) => setSku(e.target.value)} />
          </label>
        </div>

        <div
          className={`dropzone ${dragging ? "drag" : ""} ${file ? "has-file" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); pickFile(e.dataTransfer.files?.[0]); }}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov"
            hidden
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          {file ? (
            <>
              <i className="ti ti-file-check dz-icon" aria-hidden="true" />
              <span className="dz-name">{file.name}</span>
              <span className="dz-hint">Click to choose a different file</span>
            </>
          ) : (
            <>
              <i className="ti ti-upload dz-icon" aria-hidden="true" />
              <span className="dz-name">Drop a packing video here</span>
              <span className="dz-hint">MP4 or MOV — click to browse</span>
            </>
          )}
        </div>

        {err && <p className="start-error">{err}</p>}

        <button className="start-btn" onClick={handleStart} disabled={busy || !file}>
          {busy ? "Starting…" : "Verify video"}
        </button>
      </div>
    </div>
  );
}
