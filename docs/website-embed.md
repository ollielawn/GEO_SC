# Putting GEO_SC on a website

How to use the GEO_SC engine for a live, spinning logo on a website's home page, scaling cleanly from phones to big monitors.

The website gets **one self-contained folder**, `geo-sc/`. It holds the player, the engine (copied unchanged from GEO_SC) and your exported scenes. Nothing in it refers back to GEO_SC, so the website's Claude agent only ever needs access to the website repo. You run one command on your own machine to update the folder, and the website agent only wires it into the page.

- **Part 1** is for you: design, export, copy, hand over.
- **Part 2** is what to tell the website's agent.
- **Part 3** explains how it works, for when something needs changing.

---

## Part 1: your steps

### 1. Design the look in GEO_SC

```sh
cd GEO_SC && npm start      # open http://localhost:5173
```

1. Drop in your logo. A PNG with a transparent background works best. On a solid background, raise **Remove background** until the background disappears.
2. Build the look as usual: spin, scan, background, effects.
3. Keep it light enough for phones:
   - Any **Depth from** works, AI included. The export carries the finished depth map, so the website never runs the model.
   - Use **Particles: Medium** at most. The player lowers the count on small screens anyway.
   - Use at most two or three effects. Trails and Datamosh are the heaviest.
   - Geometry, tracking and the VHS on-screen display aren't drawn by the website player yet, so leave them off.
4. For a loop that never jumps, set **Spin** in whole turns (1, −1, 2…). All other auto motion already repeats every cycle.

### 2. Export for website

1. Click **Save preset** and name it, say, `Home`. The export folder takes its name from the preset you're on.
2. In the **Export** section, click **Export for website**. GEO_SC writes `exports/home/`:

   | File | What it is |
   | --- | --- |
   | `scene.json` | Every setting (including ones presets leave out), the camera, the moment the stills were taken, the source details, and a fingerprint of the engine code |
   | `logo.png` | The exact pixels GEO_SC renders from |
   | `depth.png` | The depth map at 16-bit precision, so even AI depth carries over without the model |
   | `still-wide.jpg`, `still-tall.jpg` | 1920×1080 and 1080×1920 fallback stills. The tall one is framed the way the player frames phones. |

   Export works when GEO_SC runs with `npm start`. Without it you get a single download instead, which `npm run web` can't use.

### 3. Copy it into the website repo

With both repos on your machine, from the GEO_SC folder:

```sh
npm run web -- ../your-website/geo-sc
```

Put the folder wherever the website serves files from: the site root, or `public/` if the site has one. The README in the folder assumes it's served at `/geo-sc/`.

This copies the player, the engine and every scene in `exports/` (add `--scene home` to copy just one). It writes a `MANIFEST.json` listing what it wrote. Next time it replaces exactly those files and leaves anything else in the folder alone. It won't write into a folder of other files unless you add `--force`.

It also checks each scene against the engine and warns if a scene needs exporting again.

To try it without the website: `npm run web` (it writes `dist/geo-sc/`), then with `npm start` running open <http://localhost:5173/dist/geo-sc/demo.html>.

Then commit the folder in the website repo:

```sh
cd ../your-website
git add geo-sc
git commit -m "Add GEO_SC home page logo"
git push
```

### 4. Hand it to the website's agent

Start Claude Code in the website repo, as usual, with no extra access. Paste:

> There's a new folder, geo-sc/, made by my GEO_SC tool. Read geo-sc/README.md and put the "home" scene on the home page as a full-screen hero, using the HTML, CSS and script it gives. Keep the existing PHP layout and styling. Don't change anything inside geo-sc/. Show me the plan before you change any templates, then check it with geo-sc/demo.html and at phone, tablet and desktop sizes.

### 5. Check it yourself

- Open the home page, then resize the window from very narrow to very wide. The logo should stay sharp and fitted, never cropped.
- In Chrome DevTools, toggle the device toolbar and try an iPhone, an iPad and a 1440p monitor.
- On your phone: rotate it, scroll past the hero and back, and check the page still scrolls when you touch the logo.
- Open `/geo-sc/demo.html` on the site: it shows the frame rate and what the player chose for that screen.
- Add `?geo=exact` to the address to see GEO_SC's full particle count, or `?geo=off` to see the still.
- With **Reduce motion** on (System Settings → Accessibility → Display), you should see the still instead.

### 6. Changing the look later

Change it in GEO_SC, **Save** over the `Home` preset, click **Export for website**, run `npm run web -- ../your-website/geo-sc`, and commit. The page doesn't need touching.

After GEO_SC's engine changes (a new effect, a fix), export your scenes again before running `npm run web`. It warns you if you forget, and so does the browser console on the site.

---

## Part 2: for the website's agent

Everything the agent needs is in `geo-sc/README.md`, which ships inside the folder:

- the HTML, CSS and module script for the hero
- the options and URL switches
- how it adapts to screens, and how to check it
- serving notes

Its rules are short:

- Don't edit anything in `geo-sc/`: the next update overwrites it.
- The page imports only `geo-sc/player.js`.
- The `<img>` still is the real content (with alt text). The canvas is decoration over it, fading in when the class `is-ready` appears.
- Size the canvas with CSS only.

---

## Part 3: how it works

### Same engine, same numbers

```
GEO_SC app (main.js) ─┐
                      ├─► look.js: settings → frame parameters ─► renderer.js ─► WebGL2
website (player.js) ──┘
```

- `js/look.js` holds the defaults and turns settings plus the clock into one frame's parameters. The app and the player both call it, so there's one copy of that logic.
- The player loads `scene.json` over the defaults, uploads `logo.png` and the decoded 16-bit `depth.png`, and starts the clock at the moment the stills were taken.
- It's checked in headless Chromium: with `?geo=exact` at 1080×1080, the player and GEO_SC render the same frame at 0, 3.7 and 9.25 seconds, with about 10–20 pixels of the 1.17 million differing. Those trace to a handful of depth values GEO_SC recomputed.

### Fingerprint

`VERSION` holds the SHA-256 of `renderer.js`, `shaders.js`, `math.js`, `backgrounds.js`, `effects.js` and `look.js` joined in that order. Each export stamps the same fingerprint into `scene.json`. The copy script and the player both compare the two and warn on a mismatch. To check by hand:

```sh
cd js && cat renderer.js shaders.js math.js backgrounds.js effects.js look.js | shasum -a 256
```

The list lives in `ENGINE_FILES` in both `js/webexport.js` and `scripts/web.mjs`. Keep them the same.

### Scaling

| | Rule |
| --- | --- |
| Canvas pixels | CSS size × screen pixel density, density capped at 2, at most 2.5 million pixels. It reads exact device pixels when the browser reports them sensibly. |
| Framing | The logo fits the frame the way GEO_SC fits it (82% of the limiting side, times the scene's scale). |
| Portrait | Enlarged up to 1.35×, ramping in from square to phone shape, never more than 90% of the width (room for the near end to grow as it spins). The tall still uses the same rule. |
| Particles | 0.8 × √(CSS width × height) across, between 300 and the scene's count. Dot size follows spacing, so the logo looks the same, just coarser. |
| Supersampling | As designed (Smoothing 2×) when the particle buffer stays under 8 million pixels. |
| Frame-rate guard | If frames average over 20 ms for two seconds running, it steps down: supersampling off, then particles ×0.75 (twice), then pixel density 1.5, then 1. Off with `?geo=exact` or `frameGuard: false`. |
| Power | Stops when off screen (IntersectionObserver) or when the tab is hidden. |
| Fallbacks | No WebGL2, reduced motion or `?geo=off` show the still. A lost graphics context shows the still until the browser restores it, then rebuilds. |
| Input | `touch-action: pan-y`, so the page scrolls. Hover pushes and a tap bursts. No orbit or zoom. |

### Checked in headless Chromium

- The app renders pixel-identically before and after moving the frame logic into `look.js`, across three looks with backgrounds and effects.
- The player in exact mode matches GEO_SC frame for frame (above).
- Sizing:
  - Desktop at 2×: 2000×1188.
  - Phone frame: 780×1688 at ×1.17.
  - Square and banner frames.
  - iPhone 13: the first live frame lines up with the tall still.
- `?geo=off` and reduced motion leave the still showing.
- A lost context hides the canvas, and a restored one brings it back.
- Scrolling away stops drawing; scrolling back resumes.
- The copy script reruns cleanly. It refuses foreign folders and unknown scenes, and keeps files it didn't write.

Frame rates weren't measured: the software GPU there runs at about 1 fps, and the guard correctly stepped quality down. Check real numbers with `demo.html` on real devices.
