// Smudge / blend dab mixing on the GPU in floating point. 8-bit canvas compositing rounds a
// little each time, and over hundreds of dabs that drifted colours (blending flat red turned it
// lighter). Here a colour mixed with itself stays exactly the same.
//   result = canvas × (1 − w) + source × w,  w = strength × tip   (premultiplied lerp)
//   alpha lock: colours mix, the canvas's own opacity is kept.
import { makeCanvas } from './util.js';

const FS = `precision highp float;
varying vec2 v; uniform sampler2D td, ts, tm; uniform float a; uniform int lock;
void main() {
  vec4 d = texture2D(td, v), s = texture2D(ts, v);
  float w = a * texture2D(tm, v).a;
  vec4 r = d * (1.0 - w) + s * w;
  if (lock == 1) {
    vec3 dc = d.a > 0.0 ? d.rgb / d.a : vec3(0.0), sc = s.a > 0.0 ? s.rgb / s.a : dc;
    r = vec4(mix(dc, sc, w * s.a) * d.a, d.a);
  }
  gl_FragColor = r;
}`;
function makeMixer() {
  let G;
  try {
    const c = makeCanvas(1, 1), g = c.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, alpha: true });
    if (!g) return false;
    const sh = (t, src) => { const o = g.createShader(t); g.shaderSource(o, src); g.compileShader(o); if (!g.getShaderParameter(o, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(o)); return o; };
    const p = g.createProgram();
    g.attachShader(p, sh(g.VERTEX_SHADER, 'attribute vec2 p; varying vec2 v; void main() { v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }'));
    g.attachShader(p, sh(g.FRAGMENT_SHADER, FS)); g.linkProgram(p); g.useProgram(p);
    const buf = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, buf); g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
    const loc = g.getAttribLocation(p, 'p'); g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
    const tex = (unit) => { const t = g.createTexture(); g.activeTexture(g.TEXTURE0 + unit); g.bindTexture(g.TEXTURE_2D, t); for (const [k, v] of [[g.TEXTURE_MIN_FILTER, g.NEAREST], [g.TEXTURE_MAG_FILTER, g.NEAREST], [g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE], [g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE]]) g.texParameteri(g.TEXTURE_2D, k, v); return t; };
    const td = tex(0), ts = tex(1), tm = tex(2);
    g.uniform1i(g.getUniformLocation(p, 'td'), 0); g.uniform1i(g.getUniformLocation(p, 'ts'), 1); g.uniform1i(g.getUniformLocation(p, 'tm'), 2);
    // premultiplied in, premultiplied out (exact for opaque paint)
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true);
    G = { c, g, td, ts, tm, a: g.getUniformLocation(p, 'a'), lock: g.getUniformLocation(p, 'lock') };
  } catch (e) { console.warn('smudge shader unavailable', e); G = false; }
  return G;
}
// two mixers (tip dab, paint pickup) so neither has to resize its canvas back and forth
const mixers = {};
const gl = (k = 'dab') => (k in mixers ? mixers[k] : (mixers[k] = makeMixer()));
export const smudgeGLAvailable = () => !!gl();
// dst / src / mask: canvases whose top-left W×W area is the box. Returns a canvas with the result
// in its top-left W×W, or null (no WebGL).
export function mixDab(dst, src, mask, W, a, lock, which = 'dab') {
  const R = typeof window !== 'undefined' && window.__noSmudgeGL ? null : gl(which); if (!R) return null;
  const { c, g } = R;
  if (c.width !== W || c.height !== W) { c.width = W; c.height = W; }
  g.viewport(0, 0, W, W);
  const up = (unit, t, cv) => { g.activeTexture(g.TEXTURE0 + unit); g.bindTexture(g.TEXTURE_2D, t); g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, cv); };
  up(0, R.td, dst); up(1, R.ts, src); up(2, R.tm, mask);
  g.uniform1f(R.a, a); g.uniform1i(R.lock, lock ? 1 : 0);
  g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
  return c;
}
