import { useState, useRef, useEffect } from "react";
import CameraFeed from "./components/CameraFeed.jsx";
import InstructionsPanel from "./components/InstructionsPanel.jsx";
import NewtonStatusPanel from "./components/NewtonStatusPanel.jsx";
import StartScreen from "./components/StartScreen.jsx";
import { useNewtonSession } from "./lib/useNewtonSession.js";
import "./App.css";

export default function App() {
  const session = useNewtonSession();
  const [order, setOrder] = useState({ product: "", sku: "" });
  const [done, setDone] = useState(false);
  const wasRunningRef = useRef(false);

  // When Newton finishes on its own (file upload path), mark done automatically
  useEffect(() => {
    if (wasRunningRef.current && !session.running) setDone(true);
    wasRunningRef.current = session.running;
  }, [session.running]);

  async function handleStartFile(o) {
    setOrder({ product: o.product, sku: o.sku });
    setDone(false);
    await session.startFromFile(o);
  }

  async function handleStop() {
    await session.stop();
    setDone(true);
  }

  function handleReset() {
    setDone(false);
  }

  return (
    <div className="app">
      <CameraFeed ref={session.videoRef} />

      {!session.running && !done && (
        <StartScreen
          onStartFile={handleStartFile}
          mode={session.mode}
        />
      )}

      {(session.running || done) && (
        <div className="overlay">
          <InstructionsPanel
            stepState={session.stepState}
            product={order.product}
            sku={order.sku}
          />

          <NewtonStatusPanel
            status={session.status}
            log={session.log}
            elapsed={session.elapsed}
            passed={session.passed}
            total={session.total}
            done={done}
          />
        </div>
      )}

      {(session.running || done) && (
        <div className="controls">
          {session.running ? (
            <>
              {session.videoStarted && (
                <button className="pause-btn" onClick={session.toggleVideoPause}>
                  <i className={`ti ti-${session.videoPaused ? "player-play" : "player-pause"}`} aria-hidden="true" />
                  {session.videoPaused ? " Resume" : " Pause"}
                </button>
              )}
              <button className="stop-btn" onClick={handleStop}>
                <i className="ti ti-player-stop" aria-hidden="true" /> Stop
              </button>
            </>
          ) : (
            <button className="restart-btn" onClick={handleReset}>
              <i className="ti ti-refresh" aria-hidden="true" /> New verification
            </button>
          )}
        </div>
      )}
    </div>
  );
}
