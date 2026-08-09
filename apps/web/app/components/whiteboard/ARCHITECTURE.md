# Whiteboard architecture

The whiteboard used to be one 1,352-line `Whiteboard.tsx`. It is now split the
same way as the SFU server (see `apps/sfu-server/ARCHITECTURE.md`): small
feature modules that register themselves, plus one composition root.

## Layout

```
whiteboard/
  Whiteboard.tsx           composition root — React state + layout, nothing else
  index.ts                 public entry (`import Whiteboard from ".../whiteboard"`)
  types.ts                 ToolType, Shape, the ref bundles, Fabric event shapes
  constants.ts             virtual canvas size, throttles, tool defaults, limits

  canvas/                  everything that talks to Fabric
    mount.ts               creates the canvas, registers every feature, disposes
    context.ts             CanvasContext — the only thing a feature receives
    viewport.ts            zoom, pan, clamp-to-virtual-bounds
    toolMode.ts            active tool → canvas settings (selectable, cursor, brush)
    features/
      pointerTools.ts      the mouse:down/move/up pipeline
      cursorOverlay.ts     broadcast our cursor + keep the overlay aligned
      minimap.ts           paints the minimap on every render
      textSync.ts          keystroke broadcast + edit locks
      objectSync.ts        move / resize / rotate broadcast
      selectionSync.ts     canvas selection → React toolbar
    tools/
      shapeTools.ts        rect, circle, line (drag to draw)
      eraserTool.ts        click / swipe to erase
      textTool.ts          click to create or resume editing text

  net/                     the wire protocol, both directions
    emitters.ts            every outgoing wb:* message
    remoteShapes.ts        turning incoming shapes back into Fabric objects

  hooks/
    useBoardCanvas.ts      canvas lifecycle + the refs features read
    useBoardSync.ts        initial snapshot + incoming wb:* events
    useRemoteCursors.ts    other people's cursor positions

  lib/
    shape.ts               ids, Fabric ↔ wire conversion, lookup by shapeId
    boardActions.ts        toolbar actions (delete, clear, import image, restyle)
    image.ts               downscale + recompress before broadcasting
    color.ts               stable per-user cursor colour

  components/
    Toolbar.tsx            tool palette + colour / width / opacity controls
    RemoteCursorLayer.tsx  the cursor overlay
    Minimap.tsx            the minimap shell
```

## The rules

**1. `Whiteboard.tsx` holds React state and layout. Nothing else.**
If you are adding Fabric code there, it belongs in `canvas/`.

**2. A canvas feature receives `CanvasContext` and nothing else.**
No importing from `components/`, no reaching into a sibling feature. Register it
in the `canvasFeatures` array in `canvas/mount.ts`.

**3. React state never reaches the canvas directly — only through refs.**
Fabric listeners are attached once and live for the whole session, so a captured
`useState` value would go stale immediately. The component mirrors state into
`board.style.*` refs; features read `style.fill.current`. That mirroring is the
block of one-line effects near the top of `Whiteboard.tsx`.

**4. Canvas → React goes through `ctx.callbacks`.**
Those are proxied to the latest render, so they are always fresh.

**5. Every socket message goes through `net/emitters.ts`.**
No `socket.emit` anywhere else. That file is the client half of the protocol.

**6. Detach socket listeners by reference: `socket.off(event, handler)`.**
The room page listens to some of the same events. A bare `socket.off(event)`
removes *its* handlers too.

**7. Raise `suppressEmit` while applying remote state**, so incoming changes
cannot echo back out as local ones.

**8. Constants live in `constants.ts`.** No magic numbers in feature code.

## Adding a feature

### A new drawing tool (say, an arrow)

1. `types.ts` — add `"arrow"` to `ToolType`.
2. `constants.ts` — add its entry to `TOOL_DEFAULTS`.
3. `canvas/tools/shapeTools.ts` — add a branch to `startShape` and `resizeShape`.
   (If it is not a drag-to-draw tool, give it its own file in `canvas/tools/`
   and call it from `pointerTools.ts` like the text tool.)
4. `components/Toolbar.tsx` — add it to `TOOLS`.

`toolMode.ts` only needs a case if the tool changes canvas-wide settings
(selection, cursor, free-drawing); ordinary shape tools fall through to
`default`.

### A new canvas behaviour (say, snap-to-grid or shape alignment guides)

1. Create `canvas/features/yourFeature.ts` exporting
   `registerYourFeature(ctx: CanvasContext)`.
2. Attach whatever Fabric listeners it needs inside that function.
3. Add it to `canvasFeatures` in `canvas/mount.ts`.

Nothing else changes. Note the one ordering constraint in that array:
`registerCursorOverlay` also listens to `mouse:move` and must stay above
`registerPointerTools`.

### A new synced object type (say, sticky notes)

1. `net/emitters.ts` — add the outgoing message.
2. `net/remoteShapes.ts` — teach `addRemoteShape` / `applyRemoteShape` how to
   rebuild it (lines already show how a special case looks).
3. `hooks/useBoardSync.ts` — add the handler to the `handlers` map.
4. Add the matching handler on the server — see
   `apps/sfu-server/src/socket/handlers/whiteboard.js`.

## Things worth knowing before you touch this

- **`shapeId` vs Fabric's own id.** Every object carries a `shapeId` we assign
  (`lib/shape.ts`) and a `__version` holding the last server version seen. The
  version is what the server's optimistic-concurrency gate checks.
- **Lines are a special case everywhere.** `toObject()` serialises coordinates
  relative to the object centre, so `fabricObjToShape` overwrites them with
  absolute `x1/y1/x2/y2`, and remote lines are rebuilt directly instead of
  through `enlivenObjects`.
- **Never `set({ type })` on a Fabric object** — `type` and `version` are
  stripped in `applyRemoteShape` for that reason.
- **Text needs `dirty = true` and `requestRenderAll()`** after a remote update,
  or the old glyphs stay on screen.
- **Don't overwrite what the local user is doing.** `useBoardSync` skips remote
  updates for the shape currently being drawn or typed into, and records only
  the version.
- **The pointer pipeline's order is the behaviour.** Pan beats every tool;
  eraser and text return early; only drag tools reach the live-sync throttle.

## Known pre-existing issues (not introduced by the refactor)

- **Text edit locks never take effect.** `wb:shapeLocked` is emitted from
  `enterEditing()` *before* `wb:createShape`, so peers receive a lock for a
  shape they do not have yet and drop it. Fixing it means emitting the create
  first in `canvas/tools/textTool.ts`.
- **`text:editing:exited` never fires** in this Fabric version when clicking
  away, so `wb:unlockShape` is never sent either. Both halves of the locking
  feature need attention together.
- **Z-order (`↑ Front` / `↓ Back`) and the `±α` opacity nudges are local only** —
  they deliberately do not broadcast, matching the previous behaviour.
