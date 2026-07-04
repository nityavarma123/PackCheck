import { forwardRef } from "react";

// Full-screen live webcam feed. Kept sharp — no blur, no dimming — so the
// operator can see the packing surface clearly. Panels float on top of this.
const CameraFeed = forwardRef(function CameraFeed(_props, ref) {
  return (
    <video
      ref={ref}
      className="camera-feed"
      autoPlay
      playsInline
      muted
    />
  );
});

export default CameraFeed;
