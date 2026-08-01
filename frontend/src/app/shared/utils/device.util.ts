// Best-effort "is this a phone/tablet" check. Used only to predict whether a
// participant's camera capture is likely portrait-oriented and may arrive
// padded to a wider frame (CAMERA_VIDEO_CONSTRAINTS in webrtc-peer.service.ts
// only requests an *ideal*, not exact, 1280x720 — many mobile browsers
// satisfy that by padding a portrait capture to fill the requested frame
// rather than rejecting it, and the padding isn't detectable from the
// track's own reported dimensions after the fact). Consumers (call-session /
// meeting-session services) send this once, at call/meeting join, so the
// other side's tile can switch from object-fit: cover (crops into that
// padding) to object-fit: contain (letterboxes around the real picture
// instead) — see the *-portrait CSS modifiers on video-tile and call-widget.
const MOBILE_UA_PATTERN = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i;

export function isMobileDevice(): boolean {
  return MOBILE_UA_PATTERN.test(navigator.userAgent);
}
