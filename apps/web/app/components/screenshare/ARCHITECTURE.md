# Screen share architecture

Split the same way as the whiteboard (`../whiteboard/ARCHITECTURE.md`) and the
SFU server (`apps/sfu-server/ARCHITECTURE.md`): small modules with one job, and
one place per concern.

## Layout

```
screenshare/
  index.ts                     public entry — the room page imports only this
  types.ts                     ShareSurface, MediaSource, Presentation, controller
  constants.ts                 getDisplayMedia options, encodings, copy, errors

  lib/
    displayMedia.ts            the only file that calls getDisplayMedia
    sources.ts                 reading the `source` label off a producer

  net/
    emitters.ts                every outgoing screen:* message + closeProducer

  hooks/
    useScreenShare.ts          presenting: capture → produce → tear down
    useRemotePresentations.ts  watching: who is presenting right now

  components/
    ShareSourcePicker.tsx      the tab / window / screen chooser
    ScreenShareButton.tsx      control-bar button + picker + error toast
    PresentationStage.tsx      the shared screen, full size
```

## How a share actually travels

There are two independent channels, and keeping them straight is the whole
design:

1. **The pixels** are an ordinary mediasoup producer, tagged
   `appData: { source: "screen" }`. The SFU stores that label and repeats it in
   `new-producer` and `getProducers`. Without it a screen share is
   indistinguishable from a webcam — both are `kind: "video"`.
2. **The announcement** is `screen:started` / `screen:stopped`, held per room in
   `room.screenShare.presenters`. This is what tells peers a presentation exists
   before its track arrives, gives it a surface label, and lets someone joining
   mid-presentation catch up via `screen:getState`.

The room page joins them: `useRemotePresentations` gives it the announcements,
its own consume loop gives it the streams, keyed by socket id.

## The rules

**1. Only `lib/displayMedia.ts` calls `getDisplayMedia`.** Everything above it
deals in `MediaStream`.

**2. Every socket message goes through `net/emitters.ts`.** That includes
`closeProducer`, which is a media-level event we happen to be the only caller
of.

**3. Detach socket listeners by reference** — `socket.off(event, handler)`. The
room page listens to `peer-disconnected` too, and a bare `socket.off(event)`
takes its handler down as well.

**4. Producers and the capture stream live in refs, not state.** `stop()` is
called from a track `ended` listener attached once at capture time; a captured
`useState` value would be stale by then.

**5. Constants and user-facing copy live in `constants.ts`.**

**6. The stage uses `object-fit: contain`, tiles use `cover`.** Cropping a face
is fine, cropping a shared screen hides the thing being pointed at.

## Things worth knowing before you touch this

- **We cannot draw the real source list.** No browser lets a page enumerate your
  tabs and windows. `ShareSourcePicker` chooses which *pane* of the browser's
  own picker opens, by passing `displaySurface`. Meet works the same way, which
  is why the wording matches.
- **A share ends three ways** and all of them must reach `stop()`: our button,
  the browser's floating "Stop sharing" bar (the track's `ended` event), and
  unmount. Miss one and the sharing bar outlives the call.
- **`producer.close()` is local only.** mediasoup-client does not tell the
  server, so `closeProducer` must be emitted or the SFU keeps forwarding a dead
  track. The server answers with `producer-closed` to everyone.
- **Screen audio is a separate producer** (`source: "screenAudio"`) and only
  exists for tab and full-screen captures. Window capture never carries audio.
- **The presenter's own preview is muted**; a remote presentation is not.
  Otherwise you hear your own shared tab back as an echo.
- **`selfBrowserSurface: "exclude"`** keeps the CollabSpace tab out of the tab
  list — sharing the meeting into the meeting is the classic hall-of-mirrors.
- **Non-Chromium browsers ignore the extra hints** (`systemAudio`,
  `surfaceSwitching`, `monitorTypeSurfaces`) and show their own picker. The flow
  still works; you just do not get the pre-selected pane.

## Adding to this

- **Another surface option** → add it to `SHARE_SURFACE_OPTIONS` and
  `DISPLAY_CAPTURE_OPTIONS` in `constants.ts`, plus `SHARE_SURFACES` in
  `apps/sfu-server/src/config.js` so the server accepts the label.
- **Per-presentation controls** (pause, quality, annotate) → a new field on the
  presentation record in `screenShare.js`, a new emitter, and a control on
  `PresentationStage`.
- **A new track source** (a media file, a second camera) → give it a name in
  `MEDIA_SOURCES` server-side and in `MediaSource` here, then teach the room
  page's consume loop where to route it.
