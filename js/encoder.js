// Offline, frame-perfect video export.
//
// Each frame is rendered on demand (no dropped frames, no real-time limit),
// encoded to H.264 with the browser's WebCodecs encoder, and written into an
// MP4 file by the small muxer below. Supported in Chrome, Edge and Safari 17+.

const CODECS = ['avc1.640034', 'avc1.640033', 'avc1.64002A', 'avc1.4D0034', 'avc1.42003E'];

export async function findEncoder(width, height, fps, bitrate) {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const codec of CODECS) {
    const config = {
      codec,
      width,
      height,
      bitrate,
      framerate: fps,
      bitrateMode: 'variable',
      latencyMode: 'quality',
      avc: { format: 'avc' },
    };
    try {
      const res = await VideoEncoder.isConfigSupported(config);
      if (res.supported) return res.config || config;
    } catch {
      /* try next */
    }
  }
  return null;
}

// renderFrame(i) must draw frame i onto `canvas` before resolving.
export async function encodeVideo({ canvas, fps, frameCount, bitrate, renderFrame, onProgress, signal }) {
  const width = canvas.width;
  const height = canvas.height;
  const config = await findEncoder(width, height, fps, bitrate);
  if (!config) throw new Error('This browser has no H.264 encoder for this size. Try Chrome, or a smaller size.');

  const samples = [];
  let description = null;
  let failure = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig?.description && !description) description = new Uint8Array(meta.decoderConfig.description);
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({ data, key: chunk.type === 'key', pts: chunk.timestamp });
    },
    error: (e) => (failure = e),
  });
  encoder.configure(config);

  const frameUs = 1e6 / fps;
  const keyEvery = Math.round(fps); // a keyframe every second keeps scrubbing snappy
  for (let i = 0; i < frameCount; i++) {
    if (signal?.aborted) {
      encoder.close();
      throw new DOMException('Render cancelled', 'AbortError');
    }
    if (failure) throw failure;
    await renderFrame(i);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
    encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
    frame.close();
    while (encoder.encodeQueueSize > 3) await new Promise((r) => setTimeout(r, 1));
    onProgress?.((i + 1) / frameCount);
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  if (!description) throw new Error('The encoder did not provide stream settings (avcC).');
  return new Blob(muxMp4({ samples, description, width, height, fps }), { type: 'video/mp4' });
}

// ---------------------------------------------------------------- MP4 muxer
// One H.264 video track, all samples in a single chunk, moov before mdat.

function box(type, ...parts) {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, size);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let o = 8;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function fullBox(type, version, flags, ...parts) {
  return box(type, u8(version), u24(flags), ...parts);
}

const u8 = (v) => Uint8Array.of(v & 255);
const u16 = (v) => Uint8Array.of((v >> 8) & 255, v & 255);
const u24 = (v) => Uint8Array.of((v >> 16) & 255, (v >> 8) & 255, v & 255);
const u32 = (v) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v >>> 0);
  return b;
};
const str = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const zeros = (n) => new Uint8Array(n);
const concat = (arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};
const MATRIX = concat([0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(u32));

export function muxMp4({ samples, description, width, height, fps }) {
  const timescale = Math.round(fps * 1000);
  const delta = 1000;
  const n = samples.length;
  const mediaDuration = n * delta;
  const movieDuration = Math.round((n / fps) * 1000); // movie timescale = 1000

  // Composition offsets, only needed if the encoder reordered frames.
  const ptsTicks = samples.map((s) => Math.round((s.pts / 1e6) * timescale));
  const offsets = ptsTicks.map((p, i) => p - i * delta);
  const reordered = offsets.some((o) => o !== 0);
  const shift = reordered ? -Math.min(0, ...offsets) : 0;

  const ftyp = box('ftyp', str('isom'), u32(512), str('isom'), str('iso2'), str('avc1'), str('mp41'));

  const mvhd = fullBox('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(movieDuration), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(2));
  const tkhd = fullBox('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(movieDuration), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(width << 16), u32(height << 16));
  const edts = reordered ? box('edts', fullBox('elst', 0, 0, u32(1), u32(movieDuration), u32(shift), u16(1), u16(0))) : new Uint8Array(0);
  const mdhd = fullBox('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(mediaDuration), u16(0x55c4), u16(0));
  const hdlr = fullBox('hdlr', 0, 0, u32(0), str('vide'), zeros(12), str('GEO_SC video\0'));
  const vmhd = fullBox('vmhd', 0, 1, zeros(8));
  const dinf = box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1)));

  const compressor = zeros(32);
  compressor.set(str('GEO_SC').slice(0, 31), 1);
  compressor[0] = 6;
  const avc1 = box(
    'avc1',
    zeros(6), u16(1), // reserved, data_reference_index
    u16(0), u16(0), zeros(12), // pre_defined, reserved, pre_defined
    u16(width), u16(height),
    u32(0x00480000), u32(0x00480000), // 72 dpi
    u32(0), u16(1), compressor, u16(0x0018), u16(0xffff),
    box('avcC', description),
  );
  const stsd = fullBox('stsd', 0, 0, u32(1), avc1);
  const stts = fullBox('stts', 0, 0, u32(1), u32(n), u32(delta));
  const keys = samples.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean);
  const stss = fullBox('stss', 0, 0, u32(keys.length), ...keys.map(u32));
  const ctts = reordered ? fullBox('ctts', 0, 0, u32(n), ...offsets.flatMap((o) => [u32(1), u32(o + shift)])) : new Uint8Array(0);
  const stsc = fullBox('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1));
  const stsz = fullBox('stsz', 0, 0, u32(0), u32(n), ...samples.map((s) => u32(s.data.length)));

  // stco needs the absolute offset of the media data, which depends on moov's
  // size; stco is fixed-size, so build once with a placeholder and patch it.
  const build = (offset) => {
    const stco = fullBox('stco', 0, 0, u32(1), u32(offset));
    const stbl = box('stbl', stsd, stts, stss, ctts, stsc, stsz, stco);
    const minf = box('minf', vmhd, dinf, stbl);
    const mdia = box('mdia', mdhd, hdlr, minf);
    const trak = box('trak', tkhd, edts, mdia);
    return box('moov', mvhd, trak);
  };
  const moovSize = build(0).length;
  const dataOffset = ftyp.length + moovSize + 8;
  const moov = build(dataOffset);

  const payload = samples.reduce((acc, s) => acc + s.data.length, 0);
  const mdatHeader = concat([u32(payload + 8), str('mdat')]);
  return [ftyp, moov, mdatHeader, ...samples.map((s) => s.data)]; // Blob parts
}
