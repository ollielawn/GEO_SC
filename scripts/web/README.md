# GEO_SC player

This folder plays a look designed in GEO_SC on a web page. It's the same engine GEO_SC renders with, so the logo moves and looks the way it was designed, at any screen size.

Everything the site needs is in this folder. It doesn't load anything from anywhere else and has no dependencies.

**Don't edit the files here.** They're written by GEO_SC (`npm run web`), and the next update replaces them. To change the look, change it in GEO_SC, export again and re-run the copy.

## What's in here

| File | What it is |
| --- | --- |
| `player.js` | The player. The only file the page imports. |
| `renderer.js`, `shaders.js`, `math.js`, `backgrounds.js`, `effects.js`, `look.js` | The GEO_SC engine, which `player.js` imports. |
| `scenes/<name>/` | One folder per exported look: `scene.json` (every setting), `logo.png`, `depth.png` (16-bit depth map), `still-wide.jpg` and `still-tall.jpg` (fallback stills). |
| `VERSION` | Fingerprint of the engine files. The player warns in the console if a scene was exported from a different engine version. |
| `MANIFEST.json` | The scenes, and the list of files the copy script owns. |
| `demo.html` | A test page with frame-shape buttons and a frame-rate readout. |

## Putting it on a page

These examples assume this folder is at `/geo-sc/` on the site and the scene is called `home`. Change both paths if yours differ.

### HTML

```html
<section class="geo-hero">
  <picture>
    <source media="(orientation: portrait)" srcset="/geo-sc/scenes/home/still-tall.jpg">
    <img src="/geo-sc/scenes/home/still-wide.jpg" alt="INKRMN" width="1920" height="1080">
  </picture>
  <canvas aria-hidden="true"></canvas>
</section>

<script type="module">
  import { mount } from '/geo-sc/player.js';
  mount(document.querySelector('.geo-hero canvas'), { scene: '/geo-sc/scenes/home/' })
    .catch((err) => console.warn(err)); // the still stays if anything goes wrong
</script>
```

The `<img>` is the real content: give it proper alt text. The canvas is decoration on top of it.

### CSS

```css
.geo-hero {
  position: relative;
  overflow: hidden;
  height: 100svh;        /* full screen; any height works */
  background: #eeefec;   /* the scene's background colour */
}
.geo-hero img {          /* the still, scaled to the full width and centred */
  position: absolute;
  left: 0;
  top: 50%;
  width: 100%;
  height: auto;
  transform: translateY(-50%);
  display: block;
}
.geo-hero canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  opacity: 0;
  transition: opacity 0.6s ease;
}
.geo-hero canvas.is-ready { opacity: 1; }
```

The scene's background colour is in `scenes/<name>/scene.json`: look up `settings.bg` (say `plain`), then `settings["bg_plain_c1"]`. It fills any space above and below the still while the page loads.

Why the still is scaled to the full width rather than with `object-fit: cover`: a wide logo is fitted to the canvas width, so a full-width still puts the logo in exactly the same place and size as the live canvas, and the fade from one to the other doesn't jump. `cover` would crop the logo on phones. If you ever export a logo that isn't wide (square or tall), use `object-fit: contain` on a full-size `<img>` instead.

Size the canvas with CSS only. Never set its `width` and `height` attributes: the player sets those from the size on screen.

## How it adapts

- **Any shape.** The logo is fitted the way GEO_SC fits it. On portrait screens it's enlarged up to 1.35× (never wider than 90% of the canvas), so it isn't tiny on phones. The tall still is rendered the same way, so fading from the still to the live canvas doesn't jump.
- **Sharpness.** Draws at the screen's pixel density, up to 2×, and at most 2.5 million pixels per frame.
- **Particle count.** Scales with the canvas size, up to the count set in GEO_SC. Dot size scales with it, so the logo looks the same, just coarser on small screens.
- **Slow devices.** If frames take longer than 20 ms for two seconds running, it steps quality down: smoothing first, then particle count, then pixel density.
- **Saves power.** Stops drawing when the canvas is scrolled off screen or the tab is hidden.
- **Falls back.** Shows the still with no WebGL2 or when the visitor has asked for reduced motion. If the graphics context is lost, it shows the still and recovers when it can.
- **Scrolling.** Touch scrolling still works over the canvas. Hovering pushes the particles and a tap or click bursts them. There's no drag-to-orbit or zoom.

## Options

`mount(canvas, options)` returns a promise for a player, or `null` when the still is shown instead.

| Option | Default | |
| --- | --- | --- |
| `scene` | (required) | URL of a scene folder |
| `maxDpr` | `2` | Most pixels per CSS pixel |
| `pixelBudget` | `2500000` | Most canvas pixels per frame |
| `mobileScale` | `1.35` | How much bigger the logo gets on portrait screens. Change it and the tall still won't match exactly. |
| `minDensity` | `300` | Fewest particles across when adapting |
| `interactive` | `true` | Hover push and tap burst |
| `exact` | `false` | No adaptations: GEO_SC's full particle count and scale |
| `frameGuard` | `true` | Step quality down on devices that can't keep up |
| `reducedMotion` | `'still'` | `'play'` ignores the visitor's reduced-motion setting |
| `onReady` | | Called after the first frame |

The player has `pause()`, `resume()` and `destroy()` methods.

## Checking

- Open `/geo-sc/demo.html` to try each scene in full-screen, phone, square and banner frames. It shows the frame rate and what the player chose.
- Add `?geo=exact` to any page URL to turn off the adaptations, or `?geo=off` to see the still only.

## Serving

- `.js` files must be served as JavaScript (`text/javascript`), which every normal server does. No special headers are needed.
- Updates change files under the same names. If the server caches `/geo-sc/` hard, visitors may get a mix of old and new engine files for a while. Give `/geo-sc/` `Cache-Control: no-cache` (the browser still caches, but checks for changes) or a short cache time. Set that in the server config, not in a file inside this folder.

## Not drawn on the website (yet)

Geometry overlays, blob tracking and the VHS on-screen display. The copy script warns when a scene uses them.

## Updating

In GEO_SC: design, **Export for website**, then

```sh
npm run web -- <path to this folder>
```

That replaces the files listed in `MANIFEST.json` and leaves anything else here alone.
