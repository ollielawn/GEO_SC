// Moving sources: video files and webcams, both played through a <video>
// element whose current frame is uploaded to the GPU every frame.
//
// Timing model (so live playback and frame-perfect export agree):
//   Every video has a position that is a pure function of the app clock.
//   - Free:   position = anchor + (clock - anchorClock) × speed, looped or held at the end
//   - Synced: the loop is stretched to N bars of the tempo; position follows the bar phase
//   Live, the <video> plays natively and is nudged back if it drifts from that
//   position. Export seeks the <video> to the exact position for each frame.

const MAX_DRIFT = 0.12; // seconds of drift tolerated live before correcting

function wrap(t, d) {
  return d > 0 ? ((t % d) + d) % d : 0;
}

function onceEvent(target, name, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      target.removeEventListener(name, on);
      reject(new Error(`Timed out waiting for ${name}`));
    }, timeout);
    function on() {
      clearTimeout(timer);
      target.removeEventListener(name, on);
      resolve();
    }
    target.addEventListener(name, on);
  });
}

function makeVideo() {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.crossOrigin = 'anonymous';
  return v;
}

export class VideoSource {
  constructor(file) {
    this.kind = 'video';
    this.file = file;
    this.url = URL.createObjectURL(file);
    this.video = makeVideo();
    this.playing = true;
    this.speed = 1;
    this.loop = true;
    this.sync = 0; // bars per loop when synced to the tempo, 0 = free
    this.anchor = 0; // free mode: video seconds at anchorClock
    this.anchorClock = 0;
    this.phase = 0; // synced mode: offset into the loop, 0..1
    this.newFrame = true;
    this.watchFrames();
  }

  async load() {
    this.video.src = this.url;
    await onceEvent(this.video, 'loadeddata', 15000);
    this.duration = Number.isFinite(this.video.duration) ? this.video.duration : 0;
    this.width = this.video.videoWidth;
    this.height = this.video.videoHeight;
    if (!this.width || !this.height) throw new Error('This video has no picture the browser can decode.');
    return this;
  }

  // Mark when a fresh frame is ready, so unchanged frames aren't re-uploaded.
  watchFrames() {
    const v = this.video;
    if (!v.requestVideoFrameCallback) return;
    const cb = () => {
      this.newFrame = true;
      v.requestVideoFrameCallback(cb);
    };
    v.requestVideoFrameCallback(cb);
  }

  // Where the video should be at a given app-clock time.
  positionAt(clock, tempo) {
    const d = this.duration || 0;
    if (this.sync > 0 && d > 0) {
      if (!this.playing) return this.phase * d;
      const loopSec = this.sync * tempo.bar;
      return wrap(((clock - this.anchorClock) / loopSec + this.phase) * d, d);
    }
    if (!this.playing) return this.anchor;
    const t = this.anchor + (clock - this.anchorClock) * this.speed;
    return this.loop ? wrap(t, d) : Math.min(Math.max(0, t), d);
  }

  rate(tempo) {
    if (this.sync > 0 && this.duration > 0) return this.duration / (this.sync * tempo.bar);
    return this.speed;
  }

  // Re-anchor so the position stays continuous when settings change.
  reanchor(clock, tempo, at = null) {
    const pos = at ?? this.positionAt(clock, tempo);
    this.anchor = pos;
    this.anchorClock = clock;
    if (this.duration > 0) this.phase = pos / this.duration;
  }

  set(changes, clock, tempo) {
    this.reanchor(clock, tempo);
    Object.assign(this, changes);
  }

  seekTo(pos, clock, tempo) {
    this.reanchor(clock, tempo, Math.min(Math.max(0, pos), this.duration || 0));
  }

  // Live: keep the <video> playing at the right rate and close to its position.
  updateLive(clock, tempo) {
    const v = this.video;
    const target = this.positionAt(clock, tempo);
    const playNow = this.playing && !(this.sync === 0 && !this.loop && target >= this.duration - 0.01);
    v.loop = this.loop || this.sync > 0;
    const r = Math.min(16, Math.max(0.0625, this.rate(tempo)));
    if (Math.abs(v.playbackRate - r) > 1e-3) v.playbackRate = r;
    if (playNow) {
      if (v.paused) v.play().catch(() => {});
      let drift = Math.abs(v.currentTime - target);
      if (this.duration) drift = Math.min(drift, this.duration - drift);
      if (drift > MAX_DRIFT * Math.max(1, r)) v.currentTime = target;
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - target) > 1 / 120) v.currentTime = target;
    }
  }

  // Export: stop playback and show exactly the frame for this clock time.
  async seekExact(clock, tempo) {
    const v = this.video;
    if (!v.paused) v.pause();
    const t = Math.min(this.positionAt(clock, tempo) + 1e-3, Math.max(0, (this.duration || 0) - 1e-3));
    if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2) return;
    const seeked = onceEvent(v, 'seeked', 8000);
    v.currentTime = t;
    await seeked;
    // Make sure the decoded frame is ready to upload.
    if (v.requestVideoFrameCallback) {
      await Promise.race([new Promise((r) => v.requestVideoFrameCallback(() => r())), new Promise((r) => setTimeout(r, 120))]);
    }
    this.newFrame = true;
  }

  dispose() {
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    URL.revokeObjectURL(this.url);
  }
}

export class CameraSource {
  constructor() {
    this.kind = 'camera';
    this.video = makeVideo();
    this.video.crossOrigin = null;
    this.stream = null;
    this.deviceId = '';
    this.label = 'Camera';
    this.newFrame = true;
    VideoSource.prototype.watchFrames.call(this);
  }

  static supported() {
    return !!navigator.mediaDevices?.getUserMedia;
  }

  static async devices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const list = await navigator.mediaDevices.enumerateDevices();
    return list.filter((d) => d.kind === 'videoinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  }

  async start(deviceId = '') {
    this.stop();
    const video = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } };
    if (deviceId) video.deviceId = { exact: deviceId };
    this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    const track = this.stream.getVideoTracks()[0];
    this.deviceId = track.getSettings().deviceId || deviceId;
    this.label = track.label || 'Camera';
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    if (this.video.readyState < 2) await onceEvent(this.video, 'loadeddata', 10000);
    this.width = this.video.videoWidth;
    this.height = this.video.videoHeight;
    return this;
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  updateLive() {
    if (this.video.paused) this.video.play().catch(() => {});
  }

  dispose() {
    this.stop();
    this.video.srcObject = null;
  }
}
