# Video, webcam and tracking: how it works

A short design note, so the decisions are written down next to the code.

## Sources

Every slot is a picture, a video file or a webcam. All three feed the same
particle renderer, backgrounds, effects, presets and export.

- **Video files** (`js/media.js`, `VideoSource`) play through a hidden `<video>`.
  Each frame is copied into a fixed-size GPU texture (`texStorage2D` once, then
  `texSubImage2D` + mipmaps per new frame).
- **Webcams** (`CameraSource`) use `getUserMedia`. The transport bar lists every
  camera, and webcams are mirrored by default.
- **Depth** for moving sources comes from brightness, computed on the GPU for
  every frame (`uSrcA.x` in the particle shader). AI depth takes about a second
  per frame, so it stays a still-picture feature.

### One timeline for live and export

A video's position is a pure function of the app clock:

- **Free**: `anchor + (clock − anchorClock) × speed`, looped or held at the end.
- **Tempo-synced**: the loop is stretched to 1–16 bars. The position follows the
  bar phase, and the playback rate becomes `duration ÷ (bars × bar length)`.

Live, the `<video>` plays natively and is nudged back if it drifts by more than
~0.12 s. Export pauses it and **seeks to the exact position for every frame**
(`seekExact`: set `currentTime`, wait for `seeked` and the next video frame).

That's why no MP4 demuxer or decoder library is needed: the browser decodes
whatever it can play (MP4/H.264, MOV, WebM). Exports and live recordings start
a playing video from its beginning (bar 1 when synced), so every export is
repeatable. A paused video exports the frame it's holding. Webcams can't be
stepped frame by frame, so they're live-record only.

## Tracking pipeline

```
source texture ──► analysis pass (GPU, ~192 px wide) ──► readback ──► JS: clean-up, connected
                   threshold · Sobel · motion                         components, IDs, smoothing
                                                                            │
overlay (2D canvas) ◄── boxes · labels · links · edge lines ◄───────────────┘
NEGATIVE boxes ──► inverted on the GPU in the composite pass, before the effects chain
```

1. **Analysis pass** (`TRACK_FRAG`): samples the source at a small size through
   its mipmaps. It writes `r` = mask (brightness threshold, colour key in chroma
   space, or frame difference against the previous analysis), `g`/`b` = Sobel
   edge strength and direction, and `a` = brightness (the next frame's motion
   reference).
2. **Readback**:
   - Live uses a ring of three pixel buffers with fences, so it never stalls.
     Results are processed in order, so the tracker sees every frame.
   - Export reads back directly.
3. **JS** (`js/tracking.js`):
   - Optional closing (grow then shrink) joins fragments.
   - 8-connected component labelling uses union-find.
   - Blobs are filtered by size (% of frame) and count.
   - Greedy nearest-centroid matching keeps IDs stable. Exponential smoothing
     and a hold time cover blobs that briefly disappear.
   - Edges are thinned with non-maximum suppression, then traced into lines
     that prefer to keep their direction.
4. **Drawing**: points on the source are mapped to the screen through the same
   motion as the particles (`displace` and `project` from `js/geometry.js`), so
   boxes and lines ride along with spin, wave, drift and morphs.

### Latency setting

- **Smooth** (default): the analysis runs after drawing, and its result is shown
  on the next frame. Live never waits on the GPU. Export deliberately uses the
  previous frame's result too, so it matches what you saw.
- **Locked**: analyse first, wait for the result, then draw, so there's no lag.
  Live this is a small blocking read every frame, which can cost frame rate on
  heavy scenes. Export behaves identically.

## Output

- **Output window** (`output.html`): a UI-free window fed by
  `canvas.captureStream()`. Drag it to a projector and press F there. Keep the
  main window visible, because browsers throttle hidden tabs.
- **Fullscreen** (F): the stage alone, letterboxed on black.
- **Performance readout** (I): fps, CPU time per frame, tracking time and
  blob count. It's never part of an export.

## Checked in headless Chromium

There's a generated test video of moving shapes, plus a fake webcam fed from a
Y4M file of the same scene. The checks covered:

- Each box style, labels, links, edges and colour key, with positions matching
  the test video.
- Two exports of the same clip producing identical tracking on every frame.
- MP4 output validated with ffprobe.
- The camera picker, mirroring and Render being disabled for webcams.
- The output window receiving 1920×1080, and the fullscreen toggle.

Frame rates weren't measured there: the software GPU runs at about 1 fps. Use
the readout (I) on real hardware.
