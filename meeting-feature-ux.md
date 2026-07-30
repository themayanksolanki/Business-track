# Meet Hub — How the Meeting Feature Works (UX Walkthrough)

This is a user-facing walkthrough of the Meet Hub meeting experience — how someone
actually encounters, starts, joins, and uses a meeting in the app. For the technical
spec and implementation status, see `meet-hub.md`; for the outstanding-work list, see
`remaining-meethub.md`. This document only covers what a user sees and does.

---

## 1. Four ways to start a meeting

A meeting always creates the same thing under the hood (a hosted room with a shareable
`/meet/:roomCode` link), but a user can get there from four different starting points,
depending on what they're doing:

- **Meet Hub landing page** (`/meet-hub`) — the "Google Meet homepage" equivalent.
  Two big actions: **New meeting** (instant, one click, drops you straight into the
  lobby) and **Join with code** (paste/type a code someone shared with you). There's
  also a **Schedule for later** option — click it, a small form drops down asking for
  a title (optional) and a date/start-time/end-time, and submitting adds it to your
  upcoming list without joining immediately.
- **A Calendar event** — while creating or editing an event, toggling "Add Meet Hub
  room" replaces the usual "paste a Zoom/Teams link" field with a real hosted room.
  Once that's set, a **Join** button appears right on the event as soon as you're
  within 5 minutes of its start time.
- **A Project** — the project's "Actions" menu has a **Schedule Meeting** entry. It
  opens the same event-creation form as the Calendar, pre-linked to that project, and
  the meeting shows up afterward in a dedicated **Meetings** tab on the project page
  (upcoming and past, each with a join link while it's live).
- **A Group chat** — open a group conversation and there are audio/call and video-call
  buttons right in the header, same spot as a 1:1 chat's call buttons. Clicking one
  instantly creates a meeting scoped to that group and takes you straight into the
  lobby.

In every case except the group-call button, you land in the same pre-join lobby before
actually entering the room. The group-call button skips the "should I join?" question
for the person starting it (they clearly want to), but everyone else in the group still
lands in the lobby when they click through.

## 2. Getting invited without doing anything

You don't have to go looking for a meeting — the app tells you:

- **A banner on your dashboard** appears the moment a meeting you're part of is within
  5 minutes of starting, with a one-click **Join** action. Below it, a compact widget
  lists everything else coming up.
- **A notification** fires the instant someone starts a call in a group you're in
  ("_[Name] started a call in a group you're in_"), and tapping it takes you straight
  to the room. If a meeting you were invited to gets cancelled, you're notified about
  that too.
- **A message in the group chat itself** ("📞 Started a video call — [link]") — even if
  you miss the push notification, scrolling back through the conversation surfaces a
  clickable link to hop in.

## 3. The lobby (before you're actually "in")

Whichever door you came through, you land on a pre-join screen first:

- A live preview of your own camera (or a placeholder icon if you've turned it off).
- Mute and camera toggles you can set *before* anyone else sees or hears you.
- A small "choose your camera/microphone" control if your laptop has more than one of
  either — pick the right one before you commit to joining.
- One big **Join meeting** button, and only once you press it do you actually enter the
  room and become visible/audible to others.

## 4. Inside the meeting

The room is a straightforward video-tile grid — your own tile plus one per other
participant (up to 4 people total). Along the bottom is a row of controls:

- **Mute** / **Camera** — toggle your own audio/video; everyone sees the change on your
  tile instantly.
- **Share screen** — hands your entire screen (or a chosen window/tab) to everyone
  else in the room in place of your camera feed; a small "presenting" badge appears on
  your tile so people know what they're looking at. Clicking again (or using your
  browser's own "Stop sharing" bar) switches you back to camera.
- **Raise hand** — puts a small hand icon on your tile so you can signal "I want to say
  something" without interrupting whoever's talking. Toggle it off once you've had your
  turn.
- **Chat** — opens a side panel for typed messages to everyone in the room. This chat is
  just for the call itself — it's *not* the same as your regular Group/DM chat history
  and isn't saved once the meeting ends.
- **Minimize** — steps back to a floating widget so you can keep talking while browsing
  the rest of the app; the call keeps running in the background wherever you navigate.
- **Leave** — exits the call for you; everyone else keeps going.

If you're the person who started the meeting, you get two extra abilities:

- A small "remove" button on each other participant's tile, for the rare case you need
  to remove someone from the call.
- An **End meeting** button that shuts the whole thing down for everyone at once —
  every connected participant is immediately dropped back out with a "the meeting was
  ended by the host" message.

## 5. When a meeting ends

A meeting closes itself out automatically once the last person leaves — nobody has to
remember to "end" it. Importantly, if you started the call and you leave first, it does
**not** end for anyone else still on it; they keep talking exactly as if nothing
happened. Only two things end a meeting outright: everyone leaving, or the host
deliberately hitting **End meeting**.

If a *scheduled* meeting is cancelled before it ever starts, everyone who was invited
gets notified, and if it had also created a calendar entry just for itself, that entry
is cleaned up too (an event you already had, that a meeting was simply attached to,
is never touched).

## 6. Where things stand today

The whole flow above — start, get notified, join, talk, share your screen, leave — is
fully built and usable. A few smaller things are intentionally not there yet and don't
block using the feature day-to-day:

- No "waiting room" approval step — anyone with access can join directly, nobody has to
  let them in.
- No dedicated participant list — the video tiles themselves are the only "who's here"
  view.
- Meetings still cap at 4 people (by design, until there's real usage data suggesting
  the app needs to support more).
- No recording — a deliberate call, not a gap.

For the full outstanding-items list (including smaller polish like per-message read
receipts and reminder emails), see `remaining-meethub.md`.
