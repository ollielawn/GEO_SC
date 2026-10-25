// Records the canvas to a video file with the browser's MediaRecorder.
// Prefers MP4 (H.264), which Instagram takes directly. Falls back to WebM.

const CANDIDATES = [
  ['video/mp4;codecs=avc1.640028', 'mp4'],
  ['video/mp4;codecs=avc1', 'mp4'],
  ['video/mp4', 'mp4'],
  ['video/webm;codecs=vp9', 'webm'],
  ['video/webm;codecs=vp8', 'webm'],
  ['video/webm', 'webm'],
];

// Some browsers say they support a format but write empty files, so test each
// one for real: record half a second and keep the first that produces data.
export async function probeFormat(canvas) {
  if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) return null;
  for (const [mime, ext] of CANDIDATES) {
    if (!MediaRecorder.isTypeSupported(mime)) continue;
    try {
      const stream = canvas.captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: mime });
      let size = 0;
      rec.ondataavailable = (e) => (size += e.data.size);
      const done = new Promise((resolve) => (rec.onstop = resolve));
      rec.start(100);
      await new Promise((r) => setTimeout(r, 600));
      rec.stop();
      await done;
      stream.getTracks().forEach((t) => t.stop());
      if (size > 0) return { mime, ext };
    } catch {
      /* try the next one */
    }
  }
  return null;
}

export class Recorder {
  constructor(canvas) {
    this.canvas = canvas;
    this.recorder = null;
    this.chunks = [];
  }

  get active() {
    return !!this.recorder;
  }

  start(format, { fps = 60, bitrate = 20_000_000 } = {}) {
    if (!format) throw new Error('This browser cannot record video. Try Chrome or Safari.');
    const stream = this.canvas.captureStream(fps);
    this.format = format;
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: bitrate });
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.done = new Promise((resolve) => {
      this.recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(this.chunks, { type: format.mime.split(';')[0] }));
      };
    });
    this.recorder.start(250);
  }

  async stop() {
    if (!this.recorder) return null;
    const rec = this.recorder;
    this.recorder = null;
    rec.stop();
    const blob = await this.done;
    if (!blob.size) throw new Error('The recording came out empty. Try Chrome or Safari.');
    return { blob, ext: this.format.ext };
  }
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
