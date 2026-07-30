# 1:1 Call — Known Flaws

Audit of the existing 1:1 voice/video calling feature (`backend/socket.ts`'s `call:*` handlers,
`frontend/src/app/core/services/webrtc-peer.service.ts`, `frontend/src/app/pages/chat/chat.component.ts`,
`backend/controllers/chatController.ts`'s `getIceServers`). Not a redesign — this is a punch
list of concrete bugs/gaps found by reading the code, for future fixing. Nothing here has been
fixed yet.

---

## Security

1. **No org-scoping on calls (or chat) at all.**
   `getContacts` (`backend/controllers/chatController.ts:41-44`) has no `organizationId` filter,
   and `call:request` (`backend/socket.ts:288-294`) does zero org check either. Any authenticated
   user in the entire system — any organization — can discover and call any other active user.
   This breaks the per-org isolation pattern used everywhere else in the app (projects, tasks,
   etc.).

2. **Blocklist is bypassed for calls.**
   `message:send` explicitly checks `blockedUsers` both directions before allowing a chat message
   (`backend/socket.ts:174-187`). `call:request` has no equivalent check — a blocked user can
   still call, or be called by, someone who blocked them. The only gate is a client-side
   `isChatBlocked` flag in `chat.component.ts:789`, which a raw socket emit trivially bypasses.

3. **Static, non-expiring TURN credentials.**
   `chatController.ts`'s `getIceServers` hands back the exact same `TURN_USERNAME`/
   `TURN_CREDENTIAL` (raw env vars) to every user, forever — no HMAC/time-limited credential
   scheme (e.g. the standard TURN REST API pattern). A leaked response = permanent TURN relay
   access.

4. **JWT is only checked at socket handshake, never per-event.**
   `io.use(...)` (`backend/socket.ts:116-126`) verifies the JWT once at connect time. A
   revoked/expired token still works for the entire life of that socket connection — no
   per-event re-validation exists in any `socket.on('call:*', ...)` handler.

---

## Correctness / race conditions

5. **Multi-tab is broken.**
   An incoming call rings on *every* open tab of the callee (`emitToUser` fans out to all
   sockets for a userId, `backend/socket.ts:92-95`), but `call:accepted` only notifies the caller
   + the tab that answered (`backend/socket.ts:296-302`). Other idle tabs keep ringing
   indefinitely and can independently "accept" the same call again, creating a phantom second
   connection.

6. **Disconnect cleanup is keyed by userId, not socketId.**
   In `backend/socket.ts`'s `disconnect` handler (~line 407-427), the cleanup loop matches
   `session.caller === userId || session.callee === userId` across the *entire* `activeCalls`
   map for that user. Closing tab A can terminate tab B's unrelated, still-active call for the
   same user, since there's no per-socket (only per-user) association with a call.

7. **No server-side "busy" check.**
   Nothing stops N simultaneous `call:request`s to the same already-in-a-call user — each
   creates its own `activeCalls` session and rings every tab. The only busy check
   (`onCallIncoming` in `chat.component.ts:822-832`) is purely local to one tab's own
   `callState`.

8. **SPA navigation mid-call orphans the session.**
   `ngOnDestroy` (`chat.component.ts:133-136`) calls `cleanupCall()`, which never emits
   `endCall`/`rejectCall` — only the dedicated hang-up/reject buttons do that. Router-navigating
   away from chat mid-call leaves the peer never notified (`call:ended` never fires), no history
   `Message` row ever gets written for that call, and the server's `activeCalls` entry lingers
   until a much-later full socket disconnect retroactively cleans it up.

9. **Zero ICE/connection-state monitoring.**
   `WebrtcPeerService` (`frontend/src/app/core/services/webrtc-peer.service.ts`) never wires
   `oniceconnectionstatechange`/`onconnectionstatechange`/`onicecandidateerror`. If the network
   drops mid-call, media just dies silently — no ICE restart (`createOffer({iceRestart:true})`),
   no "connection lost" UI, and the call timer (driven by wall-clock, not connection state) keeps
   counting as if nothing happened.

10. **STUN-only by default; TURN is entirely optional.**
    `getIceServers` only adds a TURN entry if all three of `TURN_URLS`/`TURN_USERNAME`/
    `TURN_CREDENTIAL` are set. Anyone behind symmetric NAT or a restrictive corporate firewall
    will simply fail ICE negotiation — combined with #9, this fails silently with no diagnostic
    surfaced to the user; the call just hangs with a spinner/timer running but no media.

---

## Minor / UX

11. **Camera toggle isn't signaled to the peer.**
    `toggleMute()` has a full round trip (`socketSvc.sendMuteState` → `call:mute` →
    `remoteMuted$`), but `toggleCamera()` (`chat.component.ts:990-999`) never emits anything —
    no `call:video-toggle` event exists. The remote side only sees a frozen/black frame, with no
    explicit "camera off" indicator.

12. **No audio-only fallback if video permission is denied.**
    `startCall`/`acceptCall` request `{ audio: {...}, video: type === 'video' }` in one
    `getUserMedia` call; if the video constraint is what fails, the whole call attempt aborts
    (`cleanupCall()` + generic "Could not access your camera or microphone" notice) instead of
    retrying with `video: false`.

13. **Ringtone can silently fail to play on the very first interaction of a session.**
    The autoplay-unlock trick (`unlockAudio()`, `chat.component.ts:150-156`) relies on a prior
    `document:click` to unlock the `<audio>` elements. If the very first thing that happens in a
    session is receiving an incoming call, `ringtoneAudio.play()` can be silently rejected by the
    browser's autoplay policy (`.catch(() => {})` swallows it) — no visual/fallback indicator
    beyond the on-screen banner.

14. **No rate limiting on `call:request`.**
    Nothing throttles a user/socket firing repeated `call:request` events in a loop.

15. **No server-side unanswered-call timeout.**
    Only a client-side 30s timer (`chat.component.ts:807-809`) auto-cancels an unanswered call.
    If the caller's tab is backgrounded/throttled (timer doesn't fire), the `activeCalls` session
    sits in server memory in `'ringing'` state indefinitely, with no server-side expiry.

16. **Call-history write failures are silently swallowed.**
    `saveCallRecord`'s `catch { /* non-critical */ }` (`backend/socket.ts:129-151`) means a DB
    hiccup during `prisma.message.create` drops that call's history row with no retry, no log,
    and no error surfaced to either party — the call itself completed fine in real time, it just
    silently never appears in call history.

---

## Suggested fix order

Security items (1-4) first — #1 and #2 in particular are small, targeted changes that mirror
patterns already used elsewhere in this codebase (`canAccessProject`-style org scoping, the
existing `blockedUsers` check already present in `message:send`). Then the multi-tab/busy-check
correctness bugs (5-8), which mostly need small additions to the in-memory `activeCalls`/
`onlineUsers` bookkeeping in `backend/socket.ts`. #9/#10 (ICE monitoring + TURN) are the largest
individual items and worth scoping as their own pass. The minor/UX items (11-16) are cheap,
independent, low-risk fixes.
