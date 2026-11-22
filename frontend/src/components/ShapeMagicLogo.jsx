import { useEffect, useId, useRef, useState } from 'react'
import logoMaskUrl from '../assets/logo-mask.svg'
import { getActiveTheme, prefersReducedMotion, shouldAnimate } from '../lib/motionConfig'
import { ShinyText } from './ReactBits'

// Exact React Bits Shape Magic SDF-traced Isometric S-Hex silhouette (512x512).
// Generated via pointy-top rounded hexagon SDF carved by twin -30° isometric
// slots with smooth-max fillets, matching frontend/src/assets/logo-mask.svg.
export const SUPERDASH_MARK_PATH =
  'M245.8 22.2 C243.7 22.7 240.7 23.6 238.7 24.3 C236.6 25.1 234 26.4 232.1 27.4 L70.3 120.8 C68.8 121.8 66.8 123 65.5 124.1 C64.1 125.1 61.7 127 60.3 128.5 C58.9 130 54.4 135.7 53.2 137.5 C52.1 139.3 50.7 142.2 50 143.9 C49.2 145.6 48.4 147.9 47.9 149.7 C47.4 151.4 46.8 154.7 46.5 156.4 C46.3 158.1 46.2 160.4 46.1 162.1 L46.1 349.9 C46.3 352.8 46.7 356.9 47.2 359.5 C47.8 362.2 48.9 365.6 50 368.1 C51 370.6 53 374.2 54.5 376.5 C56 378.7 59.1 382.3 60.3 383.5 C61.5 384.7 63.3 386.2 64.7 387 C66.2 387.9 68.8 388.9 70.6 389.4 C72.5 389.8 76.6 390.2 78.6 390.1 C80.5 390.1 83.1 389.7 85 389.2 C86.9 388.6 92.2 386.4 95.2 384.9 L275.4 281 C277 280.2 279.3 279.3 281.1 279 C282.9 278.6 286.9 278.3 288.9 278.5 C290.9 278.6 293.6 279.3 295.4 279.9 C297.1 280.5 299.3 281.7 300.8 282.6 C302.2 283.6 304 285.1 305.1 286.3 C306.3 287.5 307.7 289.4 308.6 290.9 C309.5 292.3 310.6 295 311.1 296.5 C311.6 298.1 312 300.2 312.1 301.7 C312.2 303.3 312.1 306.2 311.8 308.1 C311.5 310 310.8 312.6 310.1 314.2 C309.4 315.7 308.2 317.8 307.2 319.1 C306.2 320.5 304.6 322.2 303.3 323.4 C302 324.5 300 325.7 298.5 326.6 L144.9 415.4 C143.2 416.5 140.4 418.6 139.6 419.7 C138.7 420.8 137.7 423 137.5 423.8 C137.3 424.6 137.5 426 137.7 426.6 C137.8 427.3 138.3 428.1 138.7 428.7 C139 429.3 140.1 430.6 140.9 431.3 C141.6 431.9 143.5 433.3 144.6 434 L232.1 484.6 C234 485.6 236.9 487 238.7 487.7 C240.5 488.4 242.9 489.2 244.7 489.5 C246.6 489.9 254.9 490.8 256.8 490.8 C258.7 490.9 261.3 490.6 263.2 490.3 C265.1 490 267.8 489.5 269.7 488.9 C271.6 488.3 277.7 485.6 281 484 L442.7 390.6 C445.5 388.6 449.5 385.6 451.7 383.5 C453.9 381.3 457 377.2 458.2 375.4 C459.3 373.7 460.8 370.9 461.6 369.2 C462.3 367.5 463.3 365.2 463.8 363.4 C464.3 361.6 465.5 355.1 465.8 351.5 L465.9 162.1 C465.7 159.2 465.3 155.1 464.8 152.5 C464.2 149.8 463.1 146.4 462 143.9 C461 141.4 459 137.8 457.5 135.5 C456 133.3 452.9 129.7 451.7 128.5 C450.5 127.3 448.7 125.8 447.3 125 C445.8 124.1 443.2 123.1 441.4 122.6 C439.5 122.2 435.4 121.8 433.4 121.9 C431.5 121.9 428.9 122.3 427 122.8 C425.1 123.4 419.8 125.6 416.8 127.1 L236.6 231 C235 231.8 232.7 232.7 230.9 233 C229.1 233.4 225.1 233.7 223.1 233.5 C221.1 233.4 218.4 232.7 216.6 232.1 C214.9 231.5 212.7 230.3 211.2 229.4 C209.8 228.4 208 226.9 206.9 225.7 C205.7 224.5 204.3 222.6 203.4 221.1 C202.5 219.7 201.4 217 200.9 215.5 C200.4 213.9 200 211.8 199.9 210.3 C199.8 208.7 199.9 205.8 200.2 203.9 C200.5 202 201.2 199.4 201.9 197.8 C202.6 196.3 203.8 194.2 204.8 192.9 C205.8 191.5 207.4 189.8 208.7 188.6 C210 187.5 212 186.3 213.5 185.4 L367.1 96.6 C368.8 95.5 371.6 93.4 372.4 92.3 C373.3 91.2 374.3 89 374.5 88.2 C374.7 87.4 374.5 86 374.3 85.4 C374.2 84.7 373.7 83.9 373.3 83.3 C373 82.7 371.9 81.4 371.1 80.7 C370.4 80.1 368.5 78.7 367.4 78 L277.8 26.3 C275.5 25.2 272.1 23.8 269.7 23.1 C267.3 22.4 264 21.8 261.6 21.5 C259.2 21.2 255.9 21.1 253.6 21.2 C251.3 21.3 248 21.8 245.8 22.2 Z'

// Theme-calibrated React Bits Shape Magic material palettes (Flowing Gradient
// + 3D Inflated Bevel on modern/CRT themes; bespoke flat/outlined SVGs on
// Retro, Super, and Win98 for complete 7-theme visual parity).
const THEME_MATERIALS = {
  nocturne: {
    shader: true,
    colorA: '#3b36d6',
    colorB: '#9b99fe',
    colorC: '#2bc8b7',
    colorD: '#5eead4',
    distortion: 0.58,
    scale: 1.05,
    speed: 1.15,
    variation: 12,
    svgStops: ['#5c57f5', '#9B99FE', '#2BC8B7', '#5eead4'],
    rim: 'rgba(238,242,255,0.68)',
  },
  default: {
    shader: true,
    colorA: '#3730a3',
    colorB: '#6366f1',
    colorC: '#0d9488',
    colorD: '#2bc8b7',
    distortion: 0.54,
    scale: 1.05,
    speed: 1.05,
    variation: 12,
    svgStops: ['#4338ca', '#6366f1', '#0d9488', '#2bc8b7'],
    rim: 'rgba(255,255,255,0.6)',
  },
  glass: {
    shader: true,
    colorA: '#6d28d9',
    colorB: '#c4b5fd',
    colorC: '#2dd4bf',
    colorD: '#bae6fd',
    distortion: 0.68,
    scale: 1.0,
    speed: 1.35,
    variation: 24,
    svgStops: ['#7c3aed', '#c4b5fd', '#2dd4bf', '#bae6fd'],
    rim: 'rgba(255,255,255,0.82)',
  },
  kinetic: {
    shader: true,
    colorA: '#5b21b6',
    colorB: '#ff2e97',
    colorC: '#00f0ff',
    colorD: '#fbbf24',
    distortion: 0.78,
    scale: 0.96,
    speed: 1.9,
    variation: 37,
    svgStops: ['#7c3aed', '#ff2e97', '#00f0ff', '#fbbf24'],
    rim: 'rgba(255,255,255,0.88)',
  },
  terminal: {
    shader: true,
    colorA: '#052e16',
    colorB: '#16a34a',
    colorC: '#1aff40',
    colorD: '#86efac',
    distortion: 0.48,
    scale: 1.05,
    speed: 0.95,
    variation: 7,
    svgStops: ['#0d5c1e', '#16a34a', '#1aff40', '#86efac'],
    rim: 'rgba(134,239,172,0.75)',
  },
  retro: {
    shader: false,
    svgStops: ['#f24c00', '#ff6e24', '#f24c00', '#c44002'],
    stroke: '#121331',
    strokeWidth: 22,
    rim: 'none',
  },
  mario: {
    shader: false,
    svgStops: ['#fff07a', '#fbd000', '#f5b000', '#e52521'],
    stroke: '#000000',
    strokeWidth: 26,
    rim: 'none',
  },
  win98: {
    shader: false,
    svgStops: ['#000080', '#104e8b', '#008080', '#00a0a0'],
    stroke: '#ffffff',
    strokeWidth: 14,
    rim: 'none',
  },
}

// ============================================================================
// React Bits Shape Magic WebGL2 Procedural Material Engine
// Adapted from React Bits Shape Magic proceduralCode.js + flowing-gradient.js
// (Material adapted from Shaders.com by Shader Effects Inc., MIT License)
// ============================================================================

const VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`

const FRAGMENT = `#version 300 es
precision highp float;
#define PI 3.14159265359
#define TAU 6.28318530718
uniform sampler2D uField;
uniform sampler2D uSurf;
uniform vec2 uFieldScale;
uniform vec2 uResolution;
uniform float uTime;
uniform vec4 uMatP[8];
uniform vec4 uMatC[16];
out vec4 outColor;

#define C_colorA uMatC[0]
#define C_colorB uMatC[1]
#define C_colorC uMatC[2]
#define C_colorD uMatC[3]
#define P_distortion uMatP[0].x
#define P_scale uMatP[0].y
#define P_speed uMatP[0].z
#define P_variation uMatP[0].w

float shapeAt(vec2 q) {
  return texture(uField, q * uFieldScale + 0.5).r;
}

vec3 m_lin(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

vec3 m_srgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(0.41666)) - 0.055, step(0.0031308, c));
}

vec3 m_lch(vec3 c) {
  vec3 lms = vec3(
    0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b,
    0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b,
    0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b
  );
  vec3 q = sign(lms) * pow(abs(lms), vec3(1.0 / 3.0));
  vec3 lab = vec3(
    0.2104542553 * q.x + 0.793617785 * q.y - 0.0040720468 * q.z,
    1.9779984951 * q.x - 2.428592205 * q.y + 0.4505937099 * q.z,
    0.0259040371 * q.x + 0.7827717662 * q.y - 0.808675766 * q.z
  );
  float chroma = length(lab.yz);
  return vec3(lab.x, chroma, chroma > 1e-7 ? atan(lab.z, lab.y) : 0.0);
}

vec3 m_rgb(vec3 lch) {
  vec3 lab = vec3(lch.x, lch.y * cos(lch.z), lch.y * sin(lch.z));
  float l = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s = lab.x - 0.0894841775 * lab.y - 1.291485548 * lab.z;
  l = l * l * l;
  m = m * m * m;
  s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  );
}

vec4 m_mix(vec4 a, vec4 b, float t) {
  float wa = a.a * (1.0 - t);
  float wb = b.a * t;
  float w = wa + wb;
  return vec4((a.rgb * wa + b.rgb * wb) / max(w, 0.001), w);
}

uint m_rotl(uint x, int k) {
  return (x << uint(k)) | (x >> uint(32 - k));
}

uint m_hash(int x, int y, int z) {
  uint s = 0xdeadbeefu + 25u;
  uint a = s + uint(x);
  uint b = s + uint(y);
  uint c = s + uint(z);
  c ^= b; c -= m_rotl(b, 14);
  a ^= c; a -= m_rotl(c, 11);
  b ^= a; b -= m_rotl(a, 25);
  c ^= b; c -= m_rotl(b, 16);
  a ^= c; a -= m_rotl(c, 4);
  b ^= a; b -= m_rotl(a, 14);
  c ^= b; c -= m_rotl(b, 24);
  return c;
}

float m_grad(uint h, vec3 f) {
  h &= 15u;
  float u = h < 8u ? f.x : f.y;
  float v = h < 4u ? f.y : (h == 12u || h == 14u ? f.x : f.z);
  return ((h & 1u) != 0u ? -u : u) + ((h & 2u) != 0u ? -v : v);
}

float m_noise(vec3 p) {
  vec3 i = floor(p);
  ivec3 c = ivec3(i);
  vec3 f = p - i;
  vec3 w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = m_grad(m_hash(c.x, c.y, c.z), f);
  float n100 = m_grad(m_hash(c.x + 1, c.y, c.z), f - vec3(1.0, 0.0, 0.0));
  float n010 = m_grad(m_hash(c.x, c.y + 1, c.z), f - vec3(0.0, 1.0, 0.0));
  float n110 = m_grad(m_hash(c.x + 1, c.y + 1, c.z), f - vec3(1.0, 1.0, 0.0));
  float n001 = m_grad(m_hash(c.x, c.y, c.z + 1), f - vec3(0.0, 0.0, 1.0));
  float n101 = m_grad(m_hash(c.x + 1, c.y, c.z + 1), f - vec3(1.0, 0.0, 1.0));
  float n011 = m_grad(m_hash(c.x, c.y + 1, c.z + 1), f - vec3(0.0, 1.0, 1.0));
  float n111 = m_grad(m_hash(c.x + 1, c.y + 1, c.z + 1), f - vec3(1.0, 1.0, 1.0));
  float lo = mix(mix(n000, n100, w.x), mix(n010, n110, w.x), w.y);
  float hi = mix(mix(n001, n101, w.x), mix(n011, n111, w.x), w.y);
  return 0.982 * mix(lo, hi, w.z);
}

vec4 m_warp(vec2 at, float scale, float z, vec2 offA, vec2 offB, float reach, float strength) {
  vec3 wp = vec3(at * scale, z);
  float nx = m_noise(wp + vec3(offA, 0.0));
  float ny = m_noise(wp + vec3(offB, 0.0));
  return vec4(at + vec2(nx, ny) * reach * strength, nx, ny);
}

vec4 fill(vec2 p, float time) {
  vec2 centred = p / (1.7 * max(P_scale, 0.05));
  float t = time * P_speed * 0.075;
  float seed = P_variation * 0.17;
  float strength = P_distortion;
  float spin = m_noise(vec3(centred.x * 0.8 + t * 0.4, centred.y * 0.8 - t * 0.25, seed));
  float angle = spin * 12.566370614359172 * strength;
  vec2 rot = vec2(
    centred.x * cos(angle) - centred.y * sin(angle),
    centred.x * sin(angle) + centred.y * cos(angle)
  );
  float shearT = t * 2.0;
  float shearX = rot.x + sin(rot.y * 5.0 + shearT) / 50.0 * strength;
  float shearY = rot.y + sin(shearX * 7.5 + shearT) / 25.0 * strength;
  vec4 level1 = m_warp(vec2(shearX, shearY), 2.0, t * 0.5 + seed, vec2(5.2, 1.3), vec2(1.7, 9.2), 0.25, strength);
  float tz = t * 0.3 + seed;
  vec4 level2 = m_warp(level1.xy, 1.5, tz, vec2(8.3, 2.8), vec2(3.1, 7.4), 0.2, strength);
  float zone = m_noise(vec3(level2.xy * 1.8, tz));
  float hardness = pow(max(level1.z * 0.5 + 0.5, 0.0), 1.5);
  float edge = mix(0.5, 0.008, hardness);
  float t1 = smoothstep(-edge, edge, zone);
  float t2 = smoothstep(-edge, edge, level1.w);
  // Subtle diagonal brand anchor so indigo stays upper-left & teal stays lower-right
  float diag = clamp((p.x * 0.48 + p.y * 0.62) * 0.5 + 0.5, 0.0, 1.0);
  t1 = mix(t1, diag, 0.46);
  t2 = mix(t2, diag, 0.42);
  vec4 a = vec4(m_lch(m_lin(C_colorA.rgb)), C_colorA.a);
  vec4 b = vec4(m_lch(m_lin(C_colorB.rgb)), C_colorB.a);
  vec4 c = vec4(m_lch(m_lin(C_colorC.rgb)), C_colorC.a);
  vec4 d = vec4(m_lch(m_lin(C_colorD.rgb)), C_colorD.a);
  vec4 base = m_mix(m_mix(a, b, t1), m_mix(c, d, t1), t2);
  float fold = max(1.0 - abs(t1 * 2.0 - 1.0), 1.0 - abs(t2 * 2.0 - 1.0)) * hardness;
  float light = (level2.z * 0.5 + 0.5) * 0.12 + 0.94;
  vec3 rgb = clamp(m_rgb(base.rgb) * light * (1.0 + fold * 0.30), 0.0, 1.0);
  return vec4(m_srgb(rgb), clamp(base.a, 0.0, 1.0));
}

vec3 bevelNormal(vec2 p, out vec2 shift) {
  vec4 sf = texture(uSurf, p * uFieldScale + 0.5);
  float q = 1.0 - clamp(sf.x, 0.0, 1.0);
  float slope = q / max(sqrt(max(1.0 - q * q, 0.0)), 0.14);
  shift = -sf.yz * q * 0.18;
  return normalize(vec3(-sf.yz * slope * 0.36, 1.0));
}

vec3 dither(vec2 f) {
  float a = fract(52.9829189 * fract(dot(f, vec2(0.06711056, 0.00583715))));
  float b = fract(52.9829189 * fract(dot(f + vec2(17.0, 31.0), vec2(0.06711056, 0.00583715))));
  return vec3((a + b - 1.0) / 255.0);
}

void main() {
  float unit = min(uResolution.x, uResolution.y) * 0.5;
  vec2 frag = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  vec2 p = (frag - uResolution * 0.5) / unit;
  float px = 1.0 / unit;
  float d = shapeAt(p);
  float aa = clamp(length(vec2(dFdx(d), dFdy(d))), px * 0.5, px * 1.5);
  float cov = clamp(0.5 - d / aa, 0.0, 1.0);

  vec2 shift;
  vec3 N = bevelNormal(p, shift);
  vec4 fc = fill(p + shift, uTime);

  vec3 L = normalize(vec3(-0.46, -0.52, 0.72));
  float diffuse = max(dot(N, L), 0.0) / L.z;
  float occlusion = mix(1.0, 0.74, 1.0 - N.z);
  float bevelLit = mix(1.0, diffuse * occlusion, 0.36);

  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(N, H), 0.0), 26.0) * 0.34;
  float rim = pow(clamp(1.0 - N.z, 0.0, 1.0), 1.9) * max(dot(N.xy, L.xy) + 0.55, 0.0) * 0.32;

  vec3 shaded = clamp(fc.rgb * bevelLit + vec3(0.92, 0.96, 1.0) * spec + vec3(0.76, 0.90, 1.0) * rim + dither(gl_FragCoord.xy), 0.0, 1.0);
  float a = clamp(fc.a * cov, 0.0, 1.0);
  outColor = vec4(shaded * a, a);
}`

const toRgba = value => {
  const hex = String(value || '#ffffff').replace('#', '')
  const full = hex.length <= 4 ? hex.split('').map(c => c + c).join('') : hex
  const ch = i => parseInt(full.slice(i, i + 2), 16) / 255
  return [ch(0), ch(2), ch(4), full.length >= 8 ? ch(6) : 1]
}

// Felzenszwalb-Huttenlocher 1D squared Euclidean distance transform
const solveEdt = (grid, offset, stride, length, f, v, z) => {
  for (let i = 0; i < length; i++) f[i] = grid[offset + i * stride]
  let k = 0
  v[0] = 0
  z[0] = -1e20
  z[1] = 1e20
  for (let q = 1; q < length; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = 1e20
  }
  k = 0
  for (let q = 0; q < length; q++) {
    while (z[k + 1] < q) k++
    grid[offset + q * stride] = (q - v[k]) * (q - v[k]) + f[v[k]]
  }
}

const distances = (grid, width, height) => {
  const size = Math.max(width, height)
  const f = new Float64Array(size)
  const v = new Int32Array(size)
  const z = new Float64Array(size + 1)
  for (let x = 0; x < width; x++) solveEdt(grid, x, width, height, f, v, z)
  for (let y = 0; y < height; y++) solveEdt(grid, y * width, 1, width, f, v, z)
}

// Multigrid screened Poisson inflate solver (exact React Bits Shape Magic surface bevel)
const shrink = (data, width, height) => {
  const w = Math.max(1, Math.floor(width / 2))
  const h = Math.max(1, Math.floor(height / 2))
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * 2 * width + x * 2
      const r = Math.min(x * 2 + 1, width - 1) - x * 2
      const d = (Math.min(y * 2 + 1, height - 1) - y * 2) * width
      out[y * w + x] = (data[i] + data[i + r] + data[i + d] + data[i + d + r]) * 0.25
    }
  }
  return { data: out, width: w, height: h }
}

const grow = (coarse, cw, ch, width, height) => {
  const out = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    const fy = Math.min(Math.max((y + 0.5) / 2 - 0.5, 0), ch - 1)
    const y0 = Math.floor(fy)
    const y1 = Math.min(y0 + 1, ch - 1)
    for (let x = 0; x < width; x++) {
      const fx = Math.min(Math.max((x + 0.5) / 2 - 0.5, 0), cw - 1)
      const x0 = Math.floor(fx)
      const x1 = Math.min(x0 + 1, cw - 1)
      const a = coarse[y0 * cw + x0] * (1 - fx + x0) + coarse[y0 * cw + x1] * (fx - x0)
      const b = coarse[y1 * cw + x0] * (1 - fx + x0) + coarse[y1 * cw + x1] * (fx - x0)
      out[y * width + x] = a * (1 - fy + y0) + b * (fy - y0)
    }
  }
  return out
}

const relaxLevel = (sdf, width, height, unit, length, start, sweeps) => {
  const pixels = Math.max(length * unit, 0.75)
  const screen = 1 / (pixels * pixels)
  const count = width * height
  const inside = new Uint8Array(count)
  for (let i = 0; i < count; i++) inside[i] = sdf[i] < 0 ? 1 : 0
  const weights = new Float32Array(count * 4)
  const diagonal = new Float32Array(count)
  const theta = (c, n) => Math.max(0.1, Math.min(1, sdf[c] / (sdf[c] - sdf[n])))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = y * width + x
      if (!inside[c]) continue
      const near = [
        x + 1 < width ? c + 1 : -1,
        x > 0 ? c - 1 : -1,
        y + 1 < height ? c + width : -1,
        y > 0 ? c - width : -1,
      ]
      const t = near.map(n => (n >= 0 && inside[n] ? 1 : n >= 0 ? theta(c, n) : 0.1))
      const kx = 2 / (t[0] + t[1])
      const ky = 2 / (t[2] + t[3])
      near.forEach((n, k) => {
        weights[c * 4 + k] = n >= 0 && inside[n] ? (k < 2 ? kx : ky) / t[k] : 0
      })
      diagonal[c] = kx * (1 / t[0] + 1 / t[1]) + ky * (1 / t[2] + 1 / t[3]) + screen
    }
  }
  const u = start || new Float32Array(count)
  for (let i = 0; i < count; i++) {
    if (!inside[i]) u[i] = 0
    else if (!start) u[i] = 1 - Math.exp((sdf[i] * unit) / pixels)
  }
  for (let sweep = 0; sweep < sweeps; sweep++) {
    for (let parity = 0; parity < 2; parity++) {
      for (let y = 0; y < height; y++) {
        for (let x = (y + parity) & 1; x < width; x += 2) {
          const c = y * width + x
          if (!inside[c]) continue
          const w = c * 4
          const sum =
            screen +
            weights[w] * (u[c + 1] || 0) +
            weights[w + 1] * (u[c - 1] || 0) +
            weights[w + 2] * (u[c + width] || 0) +
            weights[w + 3] * (u[c - width] || 0)
          u[c] += 1.6 * (sum / diagonal[c] - u[c])
        }
      }
    }
  }
  return u
}

const inflate = (field, length) => {
  const { data, width, height } = field
  const unit = Math.min(width, height) / 2
  const levels = [{ data, width, height, unit }]
  while (Math.min(levels[levels.length - 1].width, levels[levels.length - 1].height) > 32) {
    const last = levels[levels.length - 1]
    levels.push({ ...shrink(last.data, last.width, last.height), unit: last.unit / 2 })
  }
  let u = null
  for (let index = levels.length - 1; index >= 0; index--) {
    const level = levels[index]
    const coarser = levels[index + 1]
    const start = u && coarser ? grow(u, coarser.width, coarser.height, level.width, level.height) : null
    const sweeps = index === levels.length - 1 ? 50 : index === 0 ? 12 : 8
    u = relaxLevel(level.data, level.width, level.height, level.unit, length, start, sweeps)
  }
  const out = new Float32Array(width * height * 4)
  const inside = i => data[i] < 0
  const theta = (c, n) => Math.max(0.08, Math.min(1, data[c] / (data[c] - data[n])))
  const slope = (c, plus, minus) => {
    const pIn = plus < 0 || inside(plus)
    const mIn = minus < 0 || inside(minus)
    const up = plus < 0 ? u[c] : pIn ? u[plus] : 0
    const um = minus < 0 ? u[c] : mIn ? u[minus] : 0
    if (pIn && mIn) return (up - um) / 2
    const tp = pIn ? 1 : theta(c, plus)
    const tm = mIn ? 1 : theta(c, minus)
    return (tm * tm * up - tp * tp * um - (tm * tm - tp * tp) * u[c]) / (tm * tp * (tm + tp))
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = y * width + x
      if (!inside(c)) continue
      out[c * 4] = u[c]
      out[c * 4 + 1] = slope(c, x + 1 < width ? c + 1 : -1, x > 0 ? c - 1 : -1) * unit
      out[c * 4 + 2] = slope(c, y + 1 < height ? c + width : -1, y > 0 ? c - width : -1) * unit
      out[c * 4 + 3] = 1
    }
  }
  const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  for (let ring = 0; ring < 2; ring++) {
    const next = out.slice()
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = (y * width + x) * 4
        if (out[c + 3] > 0.25) continue
        let sum = 0, gx = 0, gy = 0, count = 0
        for (const [dx, dy] of sides) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const k = (ny * width + nx) * 4
          if (out[k + 3] < 0.25) continue
          sum += out[k] - (out[k + 1] * dx + out[k + 2] * dy) / unit
          gx += out[k + 1]
          gy += out[k + 2]
          count += 1
        }
        if (!count) continue
        next[c] = sum / count
        next[c + 1] = gx / count
        next[c + 2] = gy / count
        next[c + 3] = 0.5
      }
    }
    out.set(next)
  }
  const weights = [1, 2, 3, 4].map(k => Math.exp(-(k * k) / 2.88))
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const source = out.slice()
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = (y * width + x) * 4
        if (source[c + 3] < 0.25) continue
        let total = 1
        const sum = [source[c], source[c + 1], source[c + 2]]
        for (let k = 1; k <= 4; k++) {
          for (const sign of [1, -1]) {
            const nx = Math.min(width - 1, Math.max(0, x + dx * k * sign))
            const ny = Math.min(height - 1, Math.max(0, y + dy * k * sign))
            const n = (ny * width + nx) * 4
            if (source[n + 3] < 0.25) continue
            const w = weights[k - 1]
            sum[0] += w * source[n]
            sum[1] += w * source[n + 1]
            sum[2] += w * source[n + 2]
            total += w
          }
        }
        out[c] = sum[0] / total
        out[c + 1] = sum[1] / total
        out[c + 2] = sum[2] / total
      }
    }
  }
  return out
}

// Compute the SDF & inflated 3D bevel surface ONCE per browser session and
// share across all mounted ShapeMagicLogo instances (sidebar, header, auth).
let cachedSurfacePromise = null
function getCachedSurface(src) {
  if (cachedSurfacePromise) return cachedSurfacePromise
  cachedSurfacePromise = new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const size = 256
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return reject(new Error('2d context unavailable'))
      ctx.drawImage(image, 0, 0, size, size)
      const pixels = ctx.getImageData(0, 0, size, size).data
      const outer = new Float64Array(size * size)
      const inner = new Float64Array(size * size)
      for (let i = 0; i < size * size; i++) {
        const a = pixels[i * 4 + 3] / 255
        const edge = 0.5 - a
        outer[i] = a >= 1 ? 0 : a <= 0 ? 1e20 : edge > 0 ? edge * edge : 0
        inner[i] = a <= 0 ? 0 : a >= 1 ? 1e20 : edge < 0 ? edge * edge : 0
      }
      distances(outer, size, size)
      distances(inner, size, size)
      const unit = size / 2
      const data = new Float32Array(size * size)
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.sqrt(outer[i]) - Math.sqrt(inner[i])) / unit
      }
      const field = { data, width: size, height: size }
      const surf = inflate(field, 0.38)
      resolve({ field, surf })
    }
    image.onerror = reject
    image.src = src
  }).catch(err => {
    cachedSurfacePromise = null
    throw err
  })
  return cachedSurfacePromise
}

const compileShader = (gl, type, source) => {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

// Theme-native static SVG emblem (renders instantaneously on first paint, under
// prefers-reduced-motion, without WebGL2, and on flat/bevel themes).
function StaticBrandSvg({ material, label }) {
  const uid = useId().replace(/:/g, '')
  const bodyId = `sd-body-${uid}`
  const sheenId = `sd-sheen-${uid}`
  const [s0, s1, s2, s3] = material.svgStops
  return (
    <svg
      viewBox="0 0 512 512"
      fill="none"
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      className="w-full h-full block"
    >
      <defs>
        <linearGradient id={bodyId} x1="88" y1="60" x2="432" y2="460" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={s0} />
          <stop offset="36%" stopColor={s1} />
          <stop offset="72%" stopColor={s2} />
          <stop offset="100%" stopColor={s3} />
        </linearGradient>
        <radialGradient id={sheenId} cx="30%" cy="22%" r="64%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.46" />
          <stop offset="44%" stopColor="#c7d2fe" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#09090e" stopOpacity="0.18" />
        </radialGradient>
      </defs>
      <path
        d={SUPERDASH_MARK_PATH}
        fill={`url(#${bodyId})`}
        stroke={material.stroke || undefined}
        strokeWidth={material.strokeWidth || undefined}
        strokeLinejoin="round"
      />
      {material.shader && <path d={SUPERDASH_MARK_PATH} fill={`url(#${sheenId})`} />}
      {material.rim && material.rim !== 'none' && (
        <path
          d={SUPERDASH_MARK_PATH}
          fill="none"
          stroke={material.rim}
          strokeWidth="6"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}

export function ShapeMagicLogo({
  size = 32,
  theme,
  animated = true,
  interactive = false,
  glow = false,
  className = '',
  label = 'SuperDash',
}) {
  const active = getActiveTheme(theme)
  const material = THEME_MATERIALS[active] || THEME_MATERIALS.nocturne
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const drawRef = useRef(null)
  const [glReady, setGlReady] = useState(false)
  const matRef = useRef(material)
  matRef.current = material

  const useShader = Boolean(material.shader)
  const allowMotion = animated && shouldAnimate(active) && !prefersReducedMotion()

  // Repaint immediately on theme switch even when motion is disabled (reduced motion)
  useEffect(() => {
    drawRef.current?.(performance.now())
  }, [active])

  useEffect(() => {
    if (!useShader) {
      setGlReady(false)
      return undefined
    }
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      powerPreference: 'low-power',
    })
    if (!gl) return undefined

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX)
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT)
    if (!vs || !fs) return undefined

    const program = gl.createProgram()
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.bindAttribLocation(program, 0, 'aPosition')
    gl.linkProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program)
      return undefined
    }

    gl.useProgram(program)
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    const uField = gl.getUniformLocation(program, 'uField')
    const uSurf = gl.getUniformLocation(program, 'uSurf')
    const uFieldScale = gl.getUniformLocation(program, 'uFieldScale')
    const uResolution = gl.getUniformLocation(program, 'uResolution')
    const uTime = gl.getUniformLocation(program, 'uTime')
    const uMatP = gl.getUniformLocation(program, 'uMatP')
    const uMatC = gl.getUniformLocation(program, 'uMatC')

    const fieldTex = gl.createTexture()
    const surfTex = gl.createTexture()
    let loaded = null
    let frame = 0
    let alive = true
    let inView = true
    let hasPainted = false
    const started = performance.now()
    const floats = new Float32Array(32)
    const colors = new Float32Array(64)

    const drawFrame = now => {
      if (!alive || !loaded) return
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.round((canvas.clientWidth || size) * ratio))
      const h = Math.max(1, Math.round((canvas.clientHeight || size) * ratio))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }

      const m = matRef.current
      colors.set(toRgba(m.colorA), 0)
      colors.set(toRgba(m.colorB), 4)
      colors.set(toRgba(m.colorC), 8)
      colors.set(toRgba(m.colorD), 12)
      floats[0] = m.distortion ?? 0.58
      floats[1] = m.scale ?? 1.05
      floats[2] = m.speed ?? 1.1
      floats[3] = m.variation ?? 12

      const { field } = loaded
      const fieldUnit = Math.min(field.width, field.height) / 2
      gl.viewport(0, 0, w, h)
      gl.uniform2f(uResolution, w, h)
      gl.uniform2f(uFieldScale, fieldUnit / field.width, fieldUnit / field.height)
      gl.uniform1f(uTime, allowMotion ? (now - started) / 1000 : 1.4)
      gl.uniform4fv(uMatP, floats)
      gl.uniform4fv(uMatC, colors)
      gl.uniform1i(uField, 0)
      gl.uniform1i(uSurf, 1)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

      if (!hasPainted) {
        hasPainted = true
        setGlReady(true)
      }
    }

    const tick = now => {
      frame = 0
      if (!alive || document.hidden || !inView) return
      drawFrame(now)
      if (allowMotion) frame = requestAnimationFrame(tick)
    }

    const schedule = () => {
      if (!alive || frame || document.hidden || !inView || !loaded) return
      frame = requestAnimationFrame(tick)
    }

    const onVis = () => {
      if (document.hidden) {
        if (frame) { cancelAnimationFrame(frame); frame = 0 }
      } else {
        schedule()
      }
    }
    document.addEventListener('visibilitychange', onVis)

    const onContextLost = e => {
      e.preventDefault()
      if (frame) { cancelAnimationFrame(frame); frame = 0 }
      setGlReady(false)
    }
    canvas.addEventListener('webglcontextlost', onContextLost)

    let io = null
    if (typeof IntersectionObserver !== 'undefined' && wrapRef.current) {
      io = new IntersectionObserver(entries => {
        inView = entries[0]?.isIntersecting ?? true
        if (!inView && frame) {
          cancelAnimationFrame(frame)
          frame = 0
        } else if (inView) {
          schedule()
        }
      })
      io.observe(wrapRef.current)
    }

    getCachedSurface(logoMaskUrl)
      .then(result => {
        if (!alive) return
        const { field, surf } = result
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, fieldTex)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, field.width, field.height, 0, gl.RED, gl.FLOAT, field.data)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, surfTex)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, field.width, field.height, 0, gl.RGBA, gl.FLOAT, surf)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.activeTexture(gl.TEXTURE0)

        if (gl.getError() !== gl.NO_ERROR) return

        loaded = result
        drawRef.current = drawFrame
        drawFrame(performance.now())
        if (allowMotion) schedule()
      })
      .catch(() => {})

    return () => {
      alive = false
      drawRef.current = null
      if (frame) cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', onVis)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      io?.disconnect()
      gl.deleteTexture(fieldTex)
      gl.deleteTexture(surfTex)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
    }
  }, [useShader, allowMotion, size])

  return (
    <span
      ref={wrapRef}
      style={{ width: size, height: size }}
      className={`sd-brand-mark relative inline-flex items-center justify-center shrink-0 select-none ${
        interactive ? 'sd-brand-interactive' : ''
      } ${glow ? 'sd-brand-glow' : ''} ${className}`}
    >
      <span
        className={`absolute inset-0 transition-opacity duration-300 ${
          useShader && glReady ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <StaticBrandSvg material={material} label={label} />
      </span>
      {useShader && (
        <canvas
          ref={canvasRef}
          aria-label={label || undefined}
          aria-hidden={label ? undefined : true}
          className={`relative block w-full h-full transition-opacity duration-300 ${
            glReady ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </span>
  )
}

const LOCKUP_SIZES = {
  sm: { icon: 24, text: 'text-sm', gap: 'gap-2' },
  md: { icon: 30, text: 'text-[15px]', gap: 'gap-2.5' },
  lg: { icon: 42, text: 'text-xl', gap: 'gap-3' },
}

// Standardized SuperDash brand lockup (Shape Magic 3D emblem + ShinyText wordmark).
export function BrandLockup({
  size = 'md',
  theme,
  subtitle,
  interactive = false,
  glow = false,
  className = '',
}) {
  const spec = LOCKUP_SIZES[size] || LOCKUP_SIZES.md
  return (
    <span className={`sd-brand-lockup inline-flex items-center ${spec.gap} ${className}`}>
      <ShapeMagicLogo
        size={spec.icon}
        theme={theme}
        interactive={interactive}
        glow={glow || size === 'lg'}
        label=""
      />
      <span className="flex flex-col leading-none">
        <span className={`font-bold ${spec.text} tracking-tight text-white`}>
          <ShinyText>SuperDash</ShinyText>
        </span>
        {subtitle && (
          <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-gray-500 mt-1">
            {subtitle}
          </span>
        )}
      </span>
    </span>
  )
}

export default ShapeMagicLogo
