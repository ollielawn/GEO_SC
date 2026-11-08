import { POINTS_VERT, POINTS_FRAG, QUAD_VERT, PRESENT_FRAG, COPY_FRAG, TRACK_FRAG } from './shaders.js';
import { BG_FRAG } from './backgrounds.js';
import { EFFECTS, glyphAtlas } from './effects.js';
import { perspective, multiply, translation, rotationX, rotationY } from './math.js';

export const FOV = (30 * Math.PI) / 180;
export const CAMERA_DISTANCE = 1 / Math.tan(FOV / 2); // frame is 2 units tall at z = 0

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('Shader compile failed:\n' + log);
  }
  return sh;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program link failed:\n' + gl.getProgramInfoLog(p));
  const cache = new Map();
  const loc = (name) => {
    if (!cache.has(name)) cache.set(name, gl.getUniformLocation(p, name));
    return cache.get(name);
  };
  return { p, loc };
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true, // lets VideoFrame/toBlob read the canvas reliably
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('This browser does not support WebGL2. Try a recent Chrome, Edge, Firefox or Safari.');
    this.gl = gl;
    this.canvas = canvas;
    this.floatTargets = !!gl.getExtension('EXT_color_buffer_float');
    this.points = program(gl, POINTS_VERT, POINTS_FRAG);
    this.bg = program(gl, QUAD_VERT, BG_FRAG);
    this.present = program(gl, QUAD_VERT, PRESENT_FRAG);
    this.copy = program(gl, QUAD_VERT, COPY_FRAG);
    this.trackProg = program(gl, QUAD_VERT, TRACK_FRAG);
    this.track = null; // { targets: [a, b], idx, w, h, ring: [{ pbo, fence, seq }], seq }
    this.negBoxes = new Float32Array(32 * 4);
    this.negCount = 0;
    this.fxPrograms = {};
    this.atlases = {};
    this.post = null; // output-size targets for the effect chain
    this.moshFresh = true;
    this.vao = gl.createVertexArray();
    this.fbo = null;
    this.frameTex = null;
    this.width = 0;
    this.height = 0;
    this.ss = 1; // supersampling factor for the particle buffer
    this.overlayTex = null;
    this.needsClear = true;
    this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.blank = this.makeBlank();
  }

  makeBlank() {
    const gl = this.gl;
    const color = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, color);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    const depth = this.depthTexture(new Float32Array([0.5]), 1, 1);
    return { color, depth, aspect: 1, width: 1, height: 1, key: [1, 1, 1] };
  }

  // w×h is the output size. Particles draw into a buffer ss× larger and are
  // averaged down on present, which keeps tiny dots sharp but not jagged.
  setSize(w, h, ss = 1) {
    ss = Math.max(1, Math.min(ss, Math.floor(this.maxTexture / Math.max(w, h))));
    if (w === this.width && h === this.height && ss === this.ss) return;
    const gl = this.gl;
    this.canvas.width = w;
    this.canvas.height = h;
    this.width = w;
    this.height = h;
    this.ss = ss;
    const fw = w * ss, fh = h * ss;
    if (this.fbo) {
      gl.deleteFramebuffer(this.fbo);
      gl.deleteTexture(this.frameTex);
    }
    this.frameTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    if (this.floatTargets) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, fw, fh, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    // At exactly 2× a bilinear tap at each output pixel centre averages 2×2 texels.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.frameTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (this.post) Object.values(this.post).flat().forEach((t) => this.freeTarget(t));
    this.post = {
      a: this.target(w, h),
      b: this.target(w, h),
      prev: this.target(w, h),
      hist: [this.target(w, h), this.target(w, h)],
    };
    this.histIdx = 0;
    this.moshFresh = true;
    this.needsClear = true;
  }

  target(w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }

  freeTarget(t) {
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  // Set uniforms from a plain object: numbers → float, arrays → vec, {int} → int.
  uniforms(prog, values) {
    const gl = this.gl;
    for (const [name, v] of Object.entries(values)) {
      const loc = prog.loc(name);
      if (loc === null) continue;
      if (typeof v === 'number') gl.uniform1f(loc, v);
      else if (v && typeof v.int === 'number') gl.uniform1i(loc, v.int);
      else if (name === 'uP') gl.uniform1fv(loc, v);
      else if (name === 'uPal') gl.uniform3fv(loc, v);
      else if (v.length === 2) gl.uniform2fv(loc, v);
      else if (v.length === 3) gl.uniform3fv(loc, v);
      else if (v.length === 4) gl.uniform4fv(loc, v);
    }
  }

  texUnit(prog, name, unit, tex) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(prog.loc(name), unit);
  }

  fxProgram(id) {
    if (!this.fxPrograms[id]) {
      const def = EFFECTS.find((e) => e.id === id);
      this.fxPrograms[id] = program(this.gl, QUAD_VERT, def.frag);
    }
    return this.fxPrograms[id];
  }

  atlas(chars) {
    if (!this.atlases[chars]) {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, glyphAtlas(chars));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.atlases[chars] = { tex, count: [...chars].length };
    }
    return this.atlases[chars];
  }

  applyEffect(fx, cur, f) {
    const gl = this.gl;
    let prog;
    try {
      prog = this.fxProgram(fx.id);
    } catch (err) {
      // A broken effect is skipped rather than stopping everything.
      this.fxFailed = this.fxFailed || {};
      if (!this.fxFailed[fx.id]) {
        this.fxFailed[fx.id] = err.message;
        console.error(`Effect "${fx.id}" failed to compile`, err);
        this.onEffectError?.(fx.id, err);
      }
      return cur;
    }
    const P = this.post;
    const mosh = fx.id === 'datamosh';
    const dst = mosh ? P.hist[this.histIdx ^ 1] : cur === P.a ? P.b : P.a;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.useProgram(prog.p);
    this.texUnit(prog, 'uSrc', 0, cur.tex);
    this.uniforms(prog, {
      uRes: [this.width, this.height],
      uUnit: Math.min(this.width, this.height) / 1080,
      uTime: f.time,
      uBeat: f.beatPhase,
      uBeats: f.beats,
      uAmount: fx.amount,
      uP: fx.p,
      uC1: fx.c1,
      uC2: fx.c2,
    });
    if (mosh) {
      this.texUnit(prog, 'uHist', 1, P.hist[this.histIdx].tex);
      this.texUnit(prog, 'uPrevSrc', 2, (this.moshFresh ? cur : P.prev).tex);
      gl.uniform1f(prog.loc('uKeyframe'), fx.keyframe || this.moshFresh ? 1 : 0);
    } else if (fx.id === 'palette') {
      gl.uniform3fv(prog.loc('uPal'), fx.palette);
      gl.uniform1i(prog.loc('uPalN'), fx.paletteSize);
    } else if (fx.id === 'ascii') {
      const at = this.atlas(fx.charset);
      this.texUnit(prog, 'uAtlas', 1, at.tex);
      gl.uniform1f(prog.loc('uGlyphs'), at.count);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (mosh) {
      // Remember this frame's input for next frame's motion estimate.
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, cur.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, P.prev.fbo);
      gl.blitFramebuffer(0, 0, cur.w, cur.h, 0, 0, cur.w, cur.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      this.histIdx ^= 1;
      this.moshFresh = false;
    }
    return dst;
  }

  depthTexture(data, w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, w, h, 0, gl.RED, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  colorTexture(source) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  // Upload the 2D overlay canvas (geometry, labels). Pass null to clear it.
  setOverlay(source) {
    const gl = this.gl;
    if (!source) {
      this.hasOverlay = false;
      return;
    }
    if (!this.overlayTex) {
      this.overlayTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.hasOverlay = true;
  }

  // Camera matrices for a frame. Shared with the geometry overlay.
  matrices(f) {
    const aspect = this.width / this.height;
    const dist = CAMERA_DISTANCE * f.zoom;
    const view = multiply(translation(0, 0, -dist), multiply(rotationX(f.pitch), rotationY(f.yaw)));
    const proj = perspective(FOV, aspect, 0.01, 100);
    return { view, proj };
  }

  // Particle grid dimensions for an image.
  grid(img, density) {
    const gx = img.aspect >= 1 ? density : Math.max(2, Math.round(density * img.aspect));
    const gy = img.aspect >= 1 ? Math.max(2, Math.round(density / img.aspect)) : density;
    return [gx, gy];
  }

  // Refresh a texture from a playing <video> (file or webcam), with mipmaps
  // so the particle grid and the tracker can sample it smoothly.
  // Fixed-size storage for a moving source, so each frame updates in place.
  videoTexture(w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  updateVideoTexture(tex, video) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  // Boxes to show in NEGATIVE: [{x0, y0, x1, y1}] in output uv (top-down).
  setNegativeBoxes(list) {
    const n = Math.min(32, list.length);
    for (let i = 0; i < n; i++) this.negBoxes.set([list[i].x0, list[i].y0, list[i].x1, list[i].y1], i * 4);
    this.negCount = n;
  }

  // ---- tracking analysis: a small pass over the source picture, read back to JS.
  trackTargets(w, h) {
    const gl = this.gl;
    if (this.track && this.track.w === w && this.track.h === h) return this.track;
    if (this.track) {
      this.track.targets.forEach((t) => this.freeTarget(t));
      for (const r of this.track.ring) {
        gl.deleteBuffer(r.pbo);
        if (r.fence) gl.deleteSync(r.fence);
      }
    }
    const targets = [this.target(w, h), this.target(w, h)];
    for (const t of targets) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    // Three pixel buffers, so a read can start every frame while earlier ones finish.
    const ring = [0, 1, 2].map(() => {
      const pbo = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, w * h * 4, gl.STREAM_READ);
      return { pbo, fence: null, seq: 0 };
    });
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.track = { targets, idx: 0, w, h, ring, seq: 0 };
    return this.track;
  }

  // Run the analysis for one source. o: { tex, srcWidth, mirror, mode, thresh, invert, key, keyTol, blur, w, h }
  trackPass(o) {
    const gl = this.gl;
    const T = this.trackTargets(o.w, o.h);
    const out = T.targets[T.idx];
    const prev = T.targets[T.idx ^ 1];
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.viewport(0, 0, o.w, o.h);
    gl.disable(gl.BLEND);
    const P = this.trackProg;
    gl.useProgram(P.p);
    this.texUnit(P, 'uSrc', 0, o.tex);
    this.texUnit(P, 'uPrev', 1, prev.tex);
    this.uniforms(P, {
      uRes: [o.w, o.h],
      uLod: Math.max(0, Math.log2(o.srcWidth / o.w)) + o.blur,
      uMirror: o.mirror ? 1 : 0,
      uThresh: o.thresh,
      uInvert: o.invert ? 1 : 0,
      uKeyTol: o.keyTol,
      uKey: o.key,
      uMode: { int: o.mode },
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    T.last = out;
    T.idx ^= 1;
  }

  // Blocking readback of the last analysis (used for frame-perfect export).
  readTrackSync() {
    const gl = this.gl;
    const T = this.track;
    if (!T || !T.last) return null;
    const data = new Uint8Array(T.w * T.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.last.fbo);
    gl.readPixels(0, 0, T.w, T.h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { data, w: T.w, h: T.h };
  }

  // Non-blocking readback for live use: copy into a free pixel buffer now and
  // collect it on a later frame once the GPU has finished. Never stalls.
  startTrackRead() {
    const gl = this.gl;
    const T = this.track;
    if (!T || !T.last) return false;
    const slot = T.ring.find((r) => !r.fence);
    if (!slot) return false; // GPU is well behind: skip this frame rather than wait
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.last.fbo);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.pbo);
    gl.readPixels(0, 0, T.w, T.h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    slot.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    slot.seq = ++T.seq;
    gl.flush();
    return true;
  }

  // Every finished readback, oldest first, so the tracker sees frames in order.
  pollTrackReads() {
    const gl = this.gl;
    const T = this.track;
    const out = [];
    if (!T) return out;
    for (;;) {
      const pending = T.ring.filter((r) => r.fence).sort((a, b) => a.seq - b.seq);
      const r = pending[0];
      if (!r) break;
      const st = gl.clientWaitSync(r.fence, 0, 0);
      if (st !== gl.ALREADY_SIGNALED && st !== gl.CONDITION_SATISFIED) break;
      gl.deleteSync(r.fence);
      r.fence = null;
      const data = new Uint8Array(T.w * T.h * 4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, r.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, data);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      out.push({ data, w: T.w, h: T.h });
    }
    return out;
  }

  resetTrack() {
    const gl = this.gl;
    if (!this.track) return;
    for (const r of this.track.ring) {
      if (r.fence) gl.deleteSync(r.fence);
      r.fence = null;
    }
    this.track.last = null;
    // Clear motion history so a fresh run starts from a known state.
    for (const t of this.track.targets) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  deleteTexture(tex) {
    if (tex && tex !== this.blank.color && tex !== this.blank.depth) this.gl.deleteTexture(tex);
  }

  // Half-size of an image of the given aspect, fitted inside the frame.
  plane(aspect, frameAspect, scale) {
    const fit = 0.82 * scale;
    if (aspect > frameAspect) {
      const hx = frameAspect * fit;
      return [hx, hx / aspect];
    }
    return [fit * aspect, fit];
  }

  // Convert a pointer position (0..1 across the canvas) to the z = 0 plane.
  pointerToWorld(nx, ny, zoom) {
    const aspect = this.width / this.height;
    return [(nx * 2 - 1) * aspect * zoom, (1 - ny * 2) * zoom, 0];
  }

  render(f) {
    const gl = this.gl;
    const W = this.width, H = this.height;
    const aspect = W / H;
    const A = f.imageA || this.blank;
    const B = f.imageB || A;

    // Particle grid follows image A's shape.
    const [gx, gy] = this.grid(A, f.density);
    const FW = W * this.ss, FH = H * this.ss;

    const planeA = this.plane(A.aspect, aspect, f.scale);
    const planeB = this.plane(B.aspect, aspect, f.scale);
    const spacing = (2 * planeA[1]) / gy;
    const pxScale = (FH / (2 * Math.tan(FOV / 2))) * spacing;

    const { view, proj } = f.view ? f : this.matrices(f);

    // ---- draw into the accumulation buffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, FW, FH);
    gl.bindVertexArray(this.vao);
    // Background: drawn fully, or at low opacity over the last frame for trails.
    const alpha = !f.trails || this.needsClear ? 1 : f.trailFade;
    if (alpha >= 1) gl.disable(gl.BLEND);
    else {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.useProgram(this.bg.p);
    this.uniforms(this.bg, {
      uType: { int: f.bg.type },
      uP: f.bg.p,
      uC1: f.bg.c1,
      uC2: f.bg.c2,
      uRes: [W, H],
      uSS: this.ss,
      uUnit: Math.min(W, H) / 1080,
      uTime: f.time,
      uAlpha: alpha,
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.needsClear = false;

    const P = this.points;
    gl.useProgram(P.p);
    gl.enable(gl.BLEND);
    if (f.glow) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const bind = (unit, name, tex) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(P.loc(name), unit);
    };
    bind(0, 'uColorA', A.color);
    bind(1, 'uDepthA', A.depth);
    bind(2, 'uColorB', B.color);
    bind(3, 'uDepthB', B.depth);
    const lod = (img) => Math.max(0, Math.log2(img.width / gx));
    gl.uniform1f(P.loc('uLodA'), lod(A));
    const srcFlags = (img) => [img.gpuDepth ? 1 : 0, f.flipDepth ? 1 : 0, img.mirror ? 1 : 0, 0];
    gl.uniform4fv(P.loc('uSrcA'), srcFlags(A));
    gl.uniform4fv(P.loc('uSrcB'), srcFlags(B));
    gl.uniform1f(P.loc('uLodB'), lod(B));
    gl.uniform2f(P.loc('uPlaneA'), planeA[0], planeA[1]);
    gl.uniform2f(P.loc('uPlaneB'), planeB[0], planeB[1]);
    gl.uniform3fv(P.loc('uKeyA'), A.key);
    gl.uniform3fv(P.loc('uKeyB'), B.key);
    gl.uniform2i(P.loc('uGrid'), gx, gy);
    gl.uniformMatrix4fv(P.loc('uProj'), false, proj);
    gl.uniformMatrix4fv(P.loc('uView'), false, view);
    const u1 = (name, v) => gl.uniform1f(P.loc(name), v);
    u1('uTime', f.time);
    u1('uPxScale', pxScale);
    u1('uSize', f.size);
    u1('uDepthAmt', f.depth);
    u1('uOpacity', f.opacity);
    u1('uKey', f.key);
    u1('uMorph', f.morph);
    u1('uMorphBurst', f.morphBurst);
    u1('uDrift', f.drift);
    u1('uSpeed', f.speed);
    u1('uStream', f.stream);
    u1('uWind', f.wind);
    u1('uScatter', f.scatter);
    u1('uBarPhase', f.barPhase);
    u1('uCyclePhase', f.cyclePhase);
    u1('uWave', f.wave);
    u1('uWaveFreq', f.waveFreq);
    u1('uWaveAngle', f.waveAngle);
    u1('uRipple', f.ripple);
    u1('uRippleFreq', f.rippleFreq);
    u1('uTwist', f.twist);
    gl.uniform3fv(P.loc('uSplashPos'), f.splashPos);
    u1('uSplash', f.splash);
    u1('uSplashR', f.splashRadius);
    u1('uScanOn', f.scan ? 1 : 0);
    u1('uScanPos', f.scanPos);
    u1('uScanWidth', f.scanWidth);
    u1('uScanBurn', f.scanBurn);
    u1('uScanJitter', f.scanJitter);
    u1('uScanAxis', f.scanAxis);
    gl.uniform3fv(P.loc('uInk'), f.ink);
    gl.uniform3fv(P.loc('uAccent'), f.accent);
    gl.uniform1i(P.loc('uColorMode'), f.colorMode);
    u1('uPaperDark', f.paperDark ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.drawArrays(gl.POINTS, 0, gx * gy);

    // ---- composite (downsample, grain, overlay) into the effect chain
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.post.a.fbo);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.useProgram(this.present.p);
    this.texUnit(this.present, 'uFrame', 0, this.frameTex);
    this.texUnit(this.present, 'uOverlay', 1, this.hasOverlay ? this.overlayTex : this.blank.color);
    this.uniforms(this.present, { uGrain: f.grain, uTime: f.time, uRes: [W, H], uHasOverlay: this.hasOverlay ? 1 : 0 });
    gl.uniform4fv(this.present.loc('uNeg'), this.negBoxes);
    gl.uniform1i(this.present.loc('uNegN'), this.negCount);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---- effects, in order
    let cur = this.post.a;
    let moshed = false;
    for (const fx of f.effects || []) {
      cur = this.applyEffect(fx, cur, f);
      if (fx.id === 'datamosh') moshed = true;
    }
    if (!moshed) this.moshFresh = true; // start clean next time it's switched on

    // ---- to the canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.copy.p);
    this.texUnit(this.copy, 'uSrc', 0, cur.tex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    return gx * gy;
  }
}
