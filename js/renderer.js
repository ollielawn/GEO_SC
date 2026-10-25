import { POINTS_VERT, POINTS_FRAG, QUAD_VERT, FADE_FRAG, PRESENT_FRAG } from './shaders.js';
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
    this.fade = program(gl, QUAD_VERT, FADE_FRAG);
    this.present = program(gl, QUAD_VERT, PRESENT_FRAG);
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
    this.needsClear = true;
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
    const bg = f.paper;
    if (!f.trails || this.needsClear) {
      gl.disable(gl.BLEND);
      gl.clearColor(bg[0], bg[1], bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.needsClear = false;
    } else {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.fade.p);
      gl.uniform4f(this.fade.loc('uFade'), bg[0], bg[1], bg[2], f.trailFade);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

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
    gl.drawArrays(gl.POINTS, 0, gx * gy);

    // ---- present to the canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.useProgram(this.present.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.uniform1i(this.present.loc('uFrame'), 0);
    gl.uniform1f(this.present.loc('uGrain'), f.grain);
    gl.uniform1f(this.present.loc('uTime'), f.time);
    gl.uniform2f(this.present.loc('uRes'), W, H);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.hasOverlay ? this.overlayTex : this.blank.color);
    gl.uniform1i(this.present.loc('uOverlay'), 1);
    gl.uniform1f(this.present.loc('uHasOverlay'), this.hasOverlay ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    return gx * gy;
  }
}
