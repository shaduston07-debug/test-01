// Video export. Uses WebCodecs (hardware H.264 / HEVC encoder) + an MP4 muxer, so encoding
// runs much faster than real time; falls back to MediaRecorder (real time) where needed.
import { makeCanvas } from './util.js';

const AVC = ['avc1.640033', 'avc1.640028', 'avc1.4d0028', 'avc1.42001f'];
const HEVC = ['hvc1.1.6.L123.B0', 'hvc1.1.6.L120.B0', 'hev1.1.6.L123.B0'];

export const canWebCodecs = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

async function pickConfig(codec, w, h, fps) {
  const bitrate = Math.round(Math.min(40e6, Math.max(2e6, w * h * fps * 0.12)));
  for (const c of codec === 'hevc' ? HEVC : AVC) {
    const cfg = { codec: c, width: w, height: h, bitrate, framerate: fps, latencyMode: 'quality' };
    try { const s = await VideoEncoder.isConfigSupported(cfg); if (s.supported) return s.config || cfg; } catch { /* next */ }
  }
  return null;
}

export async function hevcSupported(w = 1920, h = 1080) { return canWebCodecs() && !!(await pickConfig('hevc', w, h, 30)); }

// drawFrame(i, ctx, canvas) paints frame i (async ok). Returns an MP4 (or WebM fallback) Blob.
export async function encodeVideo({ width, height, fps, count, drawFrame, codec = 'avc', onProgress }) {
  const w = Math.max(2, width - (width % 2)), h = Math.max(2, height - (height % 2));
  const c = makeCanvas(w, h), x = c.getContext('2d');
  if (canWebCodecs()) {
    const cfg = await pickConfig(codec, w, h, fps);
    if (cfg) {
      const { Muxer, ArrayBufferTarget } = await import('../vendor/mp4-muxer.min.mjs');
      const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: codec === 'hevc' ? 'hevc' : 'avc', width: w, height: h, frameRate: fps }, fastStart: 'in-memory' });
      let failure = null;
      const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failure = e; } });
      enc.configure(cfg);
      const dur = 1e6 / fps;
      for (let i = 0; i < count; i++) {
        if (failure) break;
        await drawFrame(i, x, c);
        const vf = new VideoFrame(c, { timestamp: Math.round(i * dur), duration: Math.round(dur) });
        enc.encode(vf, { keyFrame: i % Math.max(1, Math.round(fps * 2)) === 0 });
        vf.close();
        // keep the encoder queue short so memory stays flat on long time-lapses
        while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
        if (onProgress && i % 10 === 0) onProgress(i / count);
      }
      if (!failure) {
        await enc.flush(); enc.close();
        muxer.finalize();
        return new Blob([muxer.target.buffer], { type: 'video/mp4' });
      }
      console.warn('WebCodecs failed, falling back', failure);
    }
  }
  // MediaRecorder fallback (plays the frames in real time)
  if (!window.MediaRecorder || !c.captureStream) throw new Error('Video export isn’t supported on this device');
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  const type = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const stream = c.captureStream(fps);
  const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 8e6 } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  await drawFrame(0, x, c);
  rec.start();
  const t0 = performance.now();
  for (let i = 0; i < count; i++) {
    await drawFrame(i, x, c);
    const due = t0 + ((i + 1) * 1000) / fps;
    await new Promise((r) => setTimeout(r, Math.max(0, due - performance.now())));
    if (onProgress && i % 10 === 0) onProgress(i / count);
  }
  rec.stop(); await stopped;
  return new Blob(chunks, { type: rec.mimeType || type || 'video/webm' });
}
