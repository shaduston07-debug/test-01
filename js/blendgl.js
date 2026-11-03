// Blend modes the 2D canvas doesn't have (Clip Studio / Photoshop): Linear Burn, Darker Color,
// Linear Dodge, Lighter Color, Vivid Light, Linear Light, Pin Light, Hard Mix, Subtract, Divide.
// The layer is drawn off-screen, then a WebGL pass blends it with what is already in the target
// (W3C compositing: Cr = (1 − αb)·Cs + αb·B(Cb, Cs), then source-over), and the result replaces
// the target. Falls back to a CPU loop where WebGL isn't available.
import { makeCanvas } from './util.js';

export const CUSTOM_BLENDS = {
  'x-linear-burn': 1, 'x-darker-color': 2, 'x-linear-dodge': 3, 'x-lighter-color': 4,
  'x-vivid-light': 5, 'x-linear-light': 6, 'x-pin-light': 7, 'x-hard-mix': 8, 'x-subtract': 9, 'x-divide': 10,
};
export const isCustomBlend = (m) => !!CUSTOM_BLENDS[m];

const FS = `precision highp float;
varying vec2 v; uniform sampler2D tb, ts; uniform int mode;
float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
float burn(float b, float s) { return b >= 1.0 ? 1.0 : (s <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - b) / s)); }
float dodge(float b, float s) { return b <= 0.0 ? 0.0 : (s >= 1.0 ? 1.0 : min(1.0, b / (1.0 - s))); }
vec3 B(vec3 b, vec3 s) {
  if (mode == 1) return max(b + s - 1.0, 0.0);
  if (mode == 2) return lum(s) < lum(b) ? s : b;
  if (mode == 3) return min(b + s, 1.0);
  if (mode == 4) return lum(s) > lum(b) ? s : b;
  if (mode == 5) { vec3 r; for (int i = 0; i < 3; i++) { float x = s[i], y = b[i]; r[i] = x <= 0.5 ? burn(y, 2.0 * x) : dodge(y, 2.0 * x - 1.0); } return r; }
  if (mode == 6) return clamp(b + 2.0 * s - 1.0, 0.0, 1.0);
  if (mode == 7) { vec3 r; for (int i = 0; i < 3; i++) { float x = s[i], y = b[i]; r[i] = x <= 0.5 ? min(y, 2.0 * x) : max(y, 2.0 * x - 1.0); } return r; }
  if (mode == 8) { vec3 r; for (int i = 0; i < 3; i++) { float x = s[i], y = b[i]; float vl = x <= 0.5 ? burn(y, 2.0 * x) : dodge(y, 2.0 * x - 1.0); r[i] = vl < 0.5 ? 0.0 : 1.0; } return r; }
  if (mode == 9) return max(b - s, 0.0);
  if (mode == 10) { vec3 r; for (int i = 0; i < 3; i++) r[i] = s[i] <= 0.0 ? (b[i] > 0.0 ? 1.0 : 0.0) : min(1.0, b[i] / s[i]); return r; }
  return s;
}
void main() {
  vec4 cb = texture2D(tb, v), cs = texture2D(ts, v); // straight (un-premultiplied) colours
  float ab = cb.a, as = cs.a;
  vec3 cr = (1.0 - ab) * cs.rgb + ab * B(cb.rgb, cs.rgb);
  float ao = as + ab * (1.0 - as);
  vec3 co = as * cr + (1.0 - as) * ab * cb.rgb; // premultiplied
  gl_FragColor = vec4(co, ao);
}`;
let G = null;
function gl() {
  if (G !== null) return G;
  try {
    const c = makeCanvas(1, 1), g = c.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    if (!g) return (G = false);
    const sh = (t, s) => { const o = g.createShader(t); g.shaderSource(o, s); g.compileShader(o); if (!g.getShaderParameter(o, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(o)); return o; };
    const p = g.createProgram();
    g.attachShader(p, sh(g.VERTEX_SHADER, 'attribute vec2 p; varying vec2 v; void main() { v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }'));
    g.attachShader(p, sh(g.FRAGMENT_SHADER, FS)); g.linkProgram(p); g.useProgram(p);
    const buf = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, buf); g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
    const loc = g.getAttribLocation(p, 'p'); g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
    const tex = (unit) => { const t = g.createTexture(); g.activeTexture(g.TEXTURE0 + unit); g.bindTexture(g.TEXTURE_2D, t); for (const [k, v] of [[g.TEXTURE_MIN_FILTER, g.NEAREST], [g.TEXTURE_MAG_FILTER, g.NEAREST], [g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE], [g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE]]) g.texParameteri(g.TEXTURE_2D, k, v); return t; };
    const tb = tex(0), ts = tex(1);
    g.uniform1i(g.getUniformLocation(p, 'tb'), 0); g.uniform1i(g.getUniformLocation(p, 'ts'), 1);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true);
    G = { c, g, tb, ts, mode: g.getUniformLocation(p, 'mode') };
  } catch (e) { console.warn('blend shader unavailable', e); G = false; }
  return G;
}

let layerTmp = null;
// draw(lctx) paints the layer (with its opacity) into a context that has ctx's transform / clip
export function blendDraw(ctx, mode, draw) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  if (!layerTmp || layerTmp.width !== W || layerTmp.height !== H) layerTmp = makeCanvas(W, H);
  const l = layerTmp.getContext('2d');
  l.setTransform(1, 0, 0, 1, 0, 0); l.globalAlpha = 1; l.globalCompositeOperation = 'source-over'; l.clearRect(0, 0, W, H);
  l.setTransform(ctx.getTransform()); l.globalAlpha = ctx.globalAlpha;
  draw(l);
  l.setTransform(1, 0, 0, 1, 0, 0); l.globalAlpha = 1;
  const R = gl();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  if (R) {
    const { c, g } = R;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    g.viewport(0, 0, W, H);
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, R.tb); g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, ctx.canvas);
    g.activeTexture(g.TEXTURE1); g.bindTexture(g.TEXTURE_2D, R.ts); g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, layerTmp);
    g.uniform1i(R.mode, CUSTOM_BLENDS[mode]);
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    ctx.globalCompositeOperation = 'copy'; ctx.drawImage(c, 0, 0);
  } else {
    // CPU fallback
    const b = ctx.getImageData(0, 0, W, H), s = l.getImageData(0, 0, W, H), bd = b.data, sd = s.data, m = CUSTOM_BLENDS[mode];
    const lum = (r, g2, bl) => 0.3 * r + 0.59 * g2 + 0.11 * bl;
    const burn = (y, x) => (y >= 1 ? 1 : x <= 0 ? 0 : 1 - Math.min(1, (1 - y) / x)), dodge = (y, x) => (y <= 0 ? 0 : x >= 1 ? 1 : Math.min(1, y / (1 - x)));
    const f = (y, x) => {
      switch (m) {
        case 1: return Math.max(y + x - 1, 0); case 3: return Math.min(y + x, 1);
        case 5: return x <= 0.5 ? burn(y, 2 * x) : dodge(y, 2 * x - 1);
        case 6: return Math.min(1, Math.max(0, y + 2 * x - 1));
        case 7: return x <= 0.5 ? Math.min(y, 2 * x) : Math.max(y, 2 * x - 1);
        case 8: return (x <= 0.5 ? burn(y, 2 * x) : dodge(y, 2 * x - 1)) < 0.5 ? 0 : 1;
        case 9: return Math.max(y - x, 0); case 10: return x <= 0 ? (y > 0 ? 1 : 0) : Math.min(1, y / x);
        default: return x;
      }
    };
    for (let i = 0; i < bd.length; i += 4) {
      const as = sd[i + 3] / 255; if (!as) continue;
      const ab = bd[i + 3] / 255, cb = [bd[i] / 255, bd[i + 1] / 255, bd[i + 2] / 255], cs = [sd[i] / 255, sd[i + 1] / 255, sd[i + 2] / 255];
      let Bv;
      if (m === 2 || m === 4) { const pick = m === 2 ? lum(...cs) < lum(...cb) : lum(...cs) > lum(...cb); Bv = pick ? cs : cb; } else Bv = cb.map((y, k) => f(y, cs[k]));
      const ao = as + ab * (1 - as);
      for (let k = 0; k < 3; k++) { const cr = (1 - ab) * cs[k] + ab * Bv[k], co = as * cr + (1 - as) * ab * cb[k]; bd[i + k] = Math.round(co / (ao || 1) * 255); }
      bd[i + 3] = Math.round(ao * 255);
    }
    ctx.putImageData(b, 0, 0);
  }
  ctx.restore();
}
