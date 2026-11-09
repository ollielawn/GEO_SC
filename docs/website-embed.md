# Putting GEO_SC on a website

How to use the GEO_SC engine for a live, spinning logo on a website's home
page, scaling cleanly from phones to big monitors.

- **Part 1** is for you: designing the look, getting the files across, and
  starting Claude Code in the website repo.
- **Part 2** is the build spec for the Claude agent in the website repo. Point
  it at this file.

The result is a small `assets/geo-sc/` folder in the website. It holds the
engine files copied unchanged from GEO_SC, a `player.js` that mounts it on a
canvas, your logo, the look as a preset, and fallback stills. There's no build
step and no dependencies. It's about 86 KB of JavaScript before compression.

---

## Part 1: your steps

### 1. Put the two repos side by side

```sh
cd ~/Sites                                       # wherever you keep projects
git clone https://github.com/ollielawn/GEO_SC    # skip if you already have it
ls
# GEO_SC/   your-website/
```

Keep them next to each other. The website's Claude agent reads GEO_SC from `../GEO_SC`.

### 2. Design the look in GEO_SC

```sh
cd ~/Sites/GEO_SC && npm start      # open http://localhost:5173
```

1. Drop in your logo. A PNG with a transparent background works best. On a
   solid background, raise **Remove background** until the background
   disappears.
2. Build the look as usual: spin, scan, background, effects.
3. Keep it light enough for phones:
   - **Depth from: Brightness** or **Flat**. AI depth isn't used on the website.
   - **Particles: Medium** at most. The player lowers it on small screens anyway.
   - At most two or three effects. Trails and Datamosh are the heaviest.
   - Geometry, tracking and the VHS on-screen display aren't part of the
     website player yet. Leave them off.
4. For a loop that never jumps, set **Spin** in whole turns (1, −1, 2…). All
   other auto motion already repeats every cycle.

### 3. Save the look and export it

1. Click **Save preset** and name it `Website home`.
2. In Presets, click **Export presets**. You get `geo_sc-presets-<date>.json`.
3. Make two fallback stills, shown before the animation loads and to anyone it
   can't run for:
   - Set Export → Shape to **Wide 16:9** and click **Save still**.
   - Set Shape to **Reel 9:16** and click **Save still**.

### 4. Copy the files into the website

```
your-website/
  assets/
    geo-sc/
      home-presets.json   ← the exported presets file, renamed
      logo.png            ← the same logo you used in GEO_SC
      still-wide.png      ← the 16:9 still
      still-tall.png      ← the 9:16 still
```

(Converting the stills to WebP is optional. The agent can do it.)

### 5. Start Claude Code in the website repo with access to GEO_SC

```sh
cd ~/Sites/your-website
claude --add-dir ../GEO_SC
```

Then paste:

> Read ../GEO_SC/docs/website-embed.md and follow Part 2. Build the GEO_SC
> player into this site and put it on the home page hero. The assets are in
> assets/geo-sc/ and the preset is called "Website home". Keep the existing PHP
> layout and styling. Show me the plan before you change any templates, then
> work through the test checklist at the end of Part 2.

### 6. Check it yourself

- Open the home page, then resize the window from very narrow to very wide.
  The logo should stay sharp and fitted, with nothing cropped.
- In Chrome DevTools, toggle the device toolbar and try iPhone, iPad and a
  1440p monitor.
- On your phone: rotate it, scroll past the hero and back, and check the page
  still scrolls normally when you touch the logo.
- In System Settings → Accessibility → Display, turn on **Reduce motion**.
  You should see the still instead.

### 7. Changing the look later

Change it in GEO_SC, **Update** the `Website home` preset, export again and
replace `assets/geo-sc/home-presets.json`. When GEO_SC's engine itself changes,
ask the website agent to "re-sync the engine files from ../GEO_SC" (see 2.2).

---

## Part 2: build spec for the website's Claude agent

### 2.1 Goal and constraints

- A live GEO_SC render of the logo in the home page hero. It fills its box, is
  sharp at any size and pixel density, and is cheap on phones.
- Plain ES modules served as static files. No bundler, no npm packages, no CDN.
- Don't change GEO_SC itself. Copy files from it.
- Keep the site's existing PHP templates and CSS conventions. Add the smallest
  possible markup, a scoped stylesheet and one module script.

### 2.2 Files to copy

Copy these from `../GEO_SC/js/` into `assets/geo-sc/engine/`, **unchanged**:

| File | Why |
| --- | --- |
| `renderer.js` | WebGL2 renderer: particles, background pass, effect chain |
| `shaders.js` | GLSL (imported by the others) |
| `math.js` | Matrix helpers |
| `backgrounds.js` | Background textures and their settings |
| `effects.js` | Post effects, palettes, ASCII glyphs |
| `depth.js` | Only `lumaDepth`, `flatDepth` and `flip` are used. Never call `aiDepth` |

Don't copy `main.js`, `media.js`, `tracking.js`, `geometry.js`, `encoder.js`,
`recorder.js` or `presets.js`. They're the app, not the engine. Port the few
functions you need from them (2.4).

Write `assets/geo-sc/engine/VERSION` with the GEO_SC commit you copied from
(`git -C ../GEO_SC rev-parse --short HEAD`). To re-sync later, copy the same
six files again and update VERSION.

### 2.3 The player: `assets/geo-sc/player.js`

```js
import { mount } from '/assets/geo-sc/player.js';

const player = await mount(canvas, {
  image: '/assets/geo-sc/logo.png',          // the logo
  preset: '/assets/geo-sc/home-presets.json', // exported presets file (or a single preset object)
  presetName: 'Website home',                 // which preset in the file
  still: document.querySelector('.hero-still'), // element to keep showing if the player can't run
  maxDpr: 2,             // never render above 2× pixel density
  pixelBudget: 2.5e6,    // most pixels drawn per frame, after DPR
  mobileScale: 1.35,     // extra logo size when the box is portrait
  interactive: true,     // cursor/touch push (no orbit, zoom or wheel on a website)
});
// player.pause(), player.resume(), player.destroy()
```

`mount` resolves to `null`, and leaves the still showing, when the player
can't or shouldn't run (2.5, step 7).

### 2.4 Driving the engine (port from `../GEO_SC/js/main.js`)

The renderer draws one frame from a plain settings object `f`:
`renderer.render(f)`. GEO_SC builds `f` in `main.js`. The player does the same
with fewer moving parts.

1. **Settings.** Port the `DEFAULTS` object and the two loops after it that add
   every background and effect setting (`bg_<id>_<param>`, `fx_<id>_on`,
   `fx_<id>_amount`, `fx_<id>_<param>`). Start from a copy of DEFAULTS and lay
   the preset's `settings` over it. Keep only keys that exist in DEFAULTS with
   the same type, as `clean()` does in `presets.js`. Apply `preset.camera`
   (`ty`, `tp`, `tz`) as the starting camera.
2. **Source.** Load the logo into an `ImageBitmap`. Scale it to 2048 px on its
   long side at most (`prepareSource`). Then build the source object the
   renderer expects:
   ```js
   const d = settings.depthMode === 'flat' ? flatDepth() : lumaDepth(img);
   const src = {
     color: renderer.colorTexture(img),
     depth: renderer.depthTexture(...(settings.flipDepth ? flip(d) : d) ...), // data, width, height
     aspect: img.width / img.height,
     width: img.width,
     key: cornerColor(img),   // port from main.js: background colour for Remove background
     gpuDepth: false,
     mirror: false,
   };
   ```
   Treat a preset with `depthMode: 'ai'` as `'luma'`.
3. **Per frame.** Port `tempo()`, `step(dt)`, `bgParams()`, `effectParams(beats)`
   and `frameParams()`, with these changes:
   - `imageA` and `imageB` are both `src`, and `morph` is 0. Drop the morph,
     preset-blend and recording code.
   - The camera has no drag or wheel input. It eases toward the preset camera,
     plus the auto motion (spin, tilt, wobble, dolly).
   - Keep `DENSITY`, `COLOR_MODES` and `SCAN_AXES`. Density is overridden by
     scaling (2.5, step 3).
   - Finish with `Object.assign(f, renderer.matrices(f))`, as `frameParams` does.
4. **Pointer.** Keep hover push and tap burst (`pointer.over`, `pointer.burst`,
   `renderer.pointerToWorld`). Use pointer events, and give the canvas
   `touch-action: pan-y` so the page still scrolls on phones. Don't add orbit,
   zoom or double-click: the canvas must never trap scrolling.
5. **Not supported** in this player: Geometry, Tracking, the VHS on-screen
   display, video and webcam sources. If the preset turns any of these on,
   ignore it and log one `console.info`.

### 2.5 Scaling

1. **Fill the box, sized by CSS.** The canvas fills its container with CSS
   (`width: 100%; height: 100%`). A `ResizeObserver` on the container
   (debounced about 100 ms) recomputes the drawing size:
   ```js
   const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
   let w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
   const k = Math.min(1, Math.sqrt(pixelBudget / (w * h)));
   w = Math.round(w * k); h = Math.round(h * k);
   renderer.setSize(w, h, 1);   // never supersample on the web: DPR already covers it
   ```
   `setSize` reallocates GPU buffers, so call it only when the size actually
   changes.
2. **Fit the logo to any shape of screen.** The renderer fits the logo inside
   the frame (`renderer.plane(aspect, frameAspect, scale)`, using 82 % of the
   limiting side × `scale`), so wide and tall boxes both work. On a portrait
   box a wide logo is width-limited and gets small. When `cssH > cssW`, use
   `scale = settings.scale * mobileScale`, capped so the logo's width stays
   within 96 % of the box.
3. **Scale the particle count with the box.**
   `density = clamp(round(0.6 × √(cssW × cssH)), 300, DENSITY[settings.density])`.
   That's about 400 on a phone and the preset's own value on a desktop. Dot
   size is relative to particle spacing in the engine, so the look holds and
   only the cost changes.
4. **Guard the frame rate.** Average the frame time over 2 s. If it's over
   20 ms:
   - first lower density by 25 % (not below 300)
   - then lower `maxDpr` to 1.5
   - then to 1

   Never step back up during a visit.
5. **Effects scale by themselves.** Backgrounds and effects are sized relative
   to a 1080 p reference (`uUnit = min(W, H) / 1080` in the renderer), so grain,
   scanlines, phosphors and ASCII cells keep their proportions. Nothing to do.
6. **Time and visibility.** Drive the clock from real time with
   `dt = min(0.1, elapsed)`. Pause the animation loop when the canvas is off
   screen (`IntersectionObserver`) or the tab is hidden (`visibilitychange`). On
   resume, reset the last-frame timestamp so nothing jumps.
7. **Fallbacks.**
   - Don't mount when `matchMedia('(prefers-reduced-motion: reduce)')` matches,
     or when `?geo=off` is in the URL (handy for testing).
   - `new Renderer()` throws without WebGL2. Catch it and return `null`.
   - On `webglcontextlost`, stop and show the still again.
   - In every case the still stays visible.
8. **Loading.**
   - The still is in the HTML, so the hero is never blank and it counts for
     Largest Contentful Paint.
   - Mount after the page loads (`requestIdleCallback`, falling back to
     `setTimeout`).
   - Once the first frame is drawn, add `is-ready` to the canvas and fade it in
     over the still.
   - Compiling the shaders can take a few hundred milliseconds on phones, which
     is why the still matters.

### 2.6 Page markup (adapt to the site's template)

```html
<section class="hero">
  <picture class="hero-still">
    <source media="(orientation: portrait)" srcset="/assets/geo-sc/still-tall.png" />
    <img src="/assets/geo-sc/still-wide.png" alt="INKRMN" width="1920" height="1080" />
  </picture>
  <canvas class="hero-geo" aria-hidden="true"></canvas>
</section>
<script type="module">
  import { mount } from '/assets/geo-sc/player.js';
  mount(document.querySelector('.hero-geo'), {
    image: '/assets/geo-sc/logo.png',
    preset: '/assets/geo-sc/home-presets.json',
    presetName: 'Website home',
    still: document.querySelector('.hero-still'),
  });
</script>
```

```css
.hero { position: relative; height: 100svh; overflow: hidden; }
.hero-still img, .hero-geo { position: absolute; inset: 0; width: 100%; height: 100%; }
.hero-still img { object-fit: cover; }
.hero-geo { opacity: 0; transition: opacity 0.6s; touch-action: pan-y; }
.hero-geo.is-ready { opacity: 1; }
@media (prefers-reduced-motion: reduce) { .hero-geo { display: none; } }
```

The stills use `object-fit: cover`, so they fill the hero the way the live
background does. Keep the logo away from the edges of the stills.

### 2.7 Test checklist

Run through these and report the results:

- [ ] Sizes 375×667, 390×844 (DPR 3), 768×1024, 1440×900 (DPR 2), 2560×1440.
  The logo is sharp, fitted and never cropped.
- [ ] Resize live from narrow to wide and back. No stretching, no flashes, no
  console errors.
- [ ] Portrait phone: `mobileScale` makes the logo comfortably big.
- [ ] Touch on a phone or emulator: the page still scrolls over the canvas.
- [ ] Reduced motion and `?geo=off` show the still only.
- [ ] WebGL2 unavailable (`chrome://flags`, or force the catch) shows the
  still only.
- [ ] Scroll the hero off screen and switch tabs: the loop pauses. Coming back
  resumes without a jump.
- [ ] DevTools Performance with 4× CPU throttling: the frame-rate guard steps
  down, and it stays smooth.
- [ ] Lighthouse mobile: no layout shift from the hero, and the still is the
  Largest Contentful Paint element.
- [ ] Safari on iOS and macOS, Chrome, Firefox.

### 2.8 Done when

- The look matches GEO_SC with the same preset. Put them side by side at the
  same aspect.
- Every item in 2.7 passes.
- `assets/geo-sc/engine/` holds only unchanged GEO_SC files, plus `VERSION`.
- The README or a short comment in the template says how to swap the preset or
  re-sync the engine.
