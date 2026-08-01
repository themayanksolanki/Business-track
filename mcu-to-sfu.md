# MCU → SFU vs. Meet Hub Roadmap — Decision

## Question

Should we migrate the current group-call media handling to an SFU next, or keep
building out the Meet Hub roadmap (Calendar/Project integration, group chat, etc.) first?

## Terminology check

There is no MCU in this codebase today. The current implementation is **mesh-style
native WebRTC** — each participant connects directly to every other participant. An MCU
(Multipoint Control Unit) decodes, mixes, and re-encodes streams server-side; an SFU
(Selective Forwarding Unit) forwards streams without re-encoding. Neither exists here —
the real comparison is **mesh → SFU**, not MCU → SFU.

## Verification (codebase, checked 2026-07-30)

1. **Zero SFU/MCU infrastructure exists.** Grepped `backend/package.json` and
   `frontend/package.json` (plus both lockfiles) for `mediasoup`, `livekit`, `daily-co`,
   `agora`, `jitsi`, `twilio-video`, `kurento`, `janus` — no hits, no transitive deps.
   Broad codebase grep for "SFU"/"MCU"/"media server" outside markdown docs turned up
   only false-positive substrings (`succe**sfu**lly`, `i**sFu**llscreen`) and one expected
   comment at `backend/socket.ts:9-10` noting the cap exists "until an SFU is worth building."

2. **The participant cap is one hardcoded constant, not deep architecture.**
   `MEETING_ROOM_CAPACITY = 4` — `backend/socket.ts:11`, enforced at `backend/socket.ts:392`
   inside the `meeting:join` handler (`if (existingSocketIds.length >= MEETING_ROOM_CAPACITY)
   { socket.emit('meeting:room-full'); ... }`). It is *not* referenced in
   `backend/controllers/meetingController.ts` — that file only has access-control logic
   (`canAccessMeeting`/`canEditMeeting`/`canEndMeeting`). Enforcement lives solely in the
   socket layer.

3. **No empirical evidence of demand for >4-person meetings.** No seed scripts anywhere
   in the repo. No test/spec files reference meetings. No TODO/FIXME/analytics/telemetry/
   performance/scale comments in any meeting-related file, backend or frontend. This would
   be a purely speculative infra investment right now.

4. **No half-finished SFU work to build on.** Both `package.json` files are clean —
   backend deps are S3, BullMQ, ioredis, Socket.IO, Prisma, etc.; frontend deps are
   standard Angular/UI libraries. Nothing orphaned or unused pointing at a video SDK.

## Recommendation: Meet Hub roadmap first. Defer SFU.

1. **No demand signal.** Nothing in the codebase or its data indicates anyone is hitting
   the 4-participant ceiling — group meetings, the feature that would actually need more
   than 4 participants, don't exist yet (see next point).
2. **Group meetings (Phase 6) are blocked on group chat (Phase 5), which hasn't
   started.** There's no shipped surface today that would even exercise a >4-person
   call, so an SFU migration now has nothing to serve.
3. **High-value, low-risk work is ready to go without touching media architecture at
   all.** Per `meet-hub.md` §5, Phases 3 (Calendar integration) and 4 (Project
   integration) "deliver the 'meetings connected to calendar and projects' ask without
   requiring group chat at all" — no SFU, no group model, reuses everything already
   shipped in Phases 1-2.
4. **This matches the plan's own stated principle** (`meet-hub.md` §3.2/§5/§6, and
   `remaining-meethub.md` §F): don't pre-build SFU speculatively — revisit only once
   group meetings ship and real participant-count data shows the mesh cap is actually
   being hit.
5. **The cap itself is cheap to bump later.** It's a single constant
   (`backend/socket.ts:11`), not something an early migration saves meaningful work on —
   there's no lock-in cost to waiting.

**Bottom line:** build Meet Hub Phase 3 → Phase 4 next (and Phase 5 → 6 if/when group
chat is prioritized). Revisit the SFU decision only when Phase 6 ships and usage data
shows real demand for meetings larger than 4 participants — self-hosted **mediasoup**
(more backend work, full control, no per-minute cost) vs. hosted **LiveKit Cloud** /
**Daily.co** (fastest integration, per-minute billing) are the two build-vs-buy options
already scoped in `remaining-meethub.md` §F for when that time comes.
