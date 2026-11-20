// Pure, zero-dependency ISO/IEC 18004 QR Code encoder (Byte mode, EC Level M,
// versions 1–10, up to 213 UTF-8 bytes) for rendering offline 2FA setup QR codes
// without sending TOTP secrets to any external service.

// [version]: [ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data, alignCoords]
const VERSION_SPEC = {
  1:  [10, 1, 16, 0, 0,  []],
  2:  [16, 1, 28, 0, 0,  [6, 18]],
  3:  [26, 1, 44, 0, 0,  [6, 22]],
  4:  [18, 2, 32, 0, 0,  [6, 26]],
  5:  [24, 2, 43, 0, 0,  [6, 30]],
  6:  [16, 4, 27, 0, 0,  [6, 34]],
  7:  [18, 4, 31, 0, 0,  [6, 22, 38]],
  8:  [22, 2, 38, 2, 39, [6, 24, 42]],
  9:  [22, 3, 36, 2, 37, [6, 26, 46]],
  10: [26, 4, 43, 1, 44, [6, 28, 50]],
}

// GF(256) lookup tables with primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d)
const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]
}

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0
  return GF_EXP[GF_LOG[a] + GF_LOG[b]]
}

function rsGenerator(degree) {
  let poly = [1]
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0)
    const factor = GF_EXP[i]
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]
      next[j + 1] ^= gfMul(poly[j], factor)
    }
    poly = next
  }
  return poly
}

export function rsComputeEC(data, ecLen) {
  const gen = rsGenerator(ecLen)
  const rem = new Uint8Array(ecLen)
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0]
    for (let j = 0; j < ecLen - 1; j++) rem[j] = rem[j + 1]
    rem[ecLen - 1] = 0
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor)
      }
    }
  }
  return rem
}

function pickVersion(byteLen) {
  for (let v = 1; v <= 10; v++) {
    const [, g1b, g1d, g2b, g2d] = VERSION_SPEC[v]
    const totalDataBytes = g1b * g1d + g2b * g2d
    const countBits = v >= 10 ? 16 : 8
    const headerBytes = Math.ceil((4 + countBits) / 8)
    if (byteLen + headerBytes <= totalDataBytes) return v
  }
  throw new Error('QR payload exceeds version 10 capacity')
}

function encodeDataCodewords(bytes, version) {
  const [, g1b, g1d, g2b, g2d] = VERSION_SPEC[version]
  const totalData = g1b * g1d + g2b * g2d
  const bits = []
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1)
  }

  // Byte mode indicator (0100) + character count
  pushBits(0b0100, 4)
  pushBits(bytes.length, version >= 10 ? 16 : 8)
  for (const b of bytes) pushBits(b, 8)

  // Terminator (up to 4 zero bits)
  const maxBits = totalData * 8
  const term = Math.min(4, maxBits - bits.length)
  for (let i = 0; i < term; i++) bits.push(0)
  // Pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0)

  const out = new Uint8Array(totalData)
  const byteCount = bits.length / 8
  for (let i = 0; i < byteCount; i++) {
    let v = 0
    for (let b = 0; b < 8; b++) v = (v << 1) | bits[i * 8 + b]
    out[i] = v
  }
  const pads = [0xec, 0x11]
  for (let i = byteCount, p = 0; i < totalData; i++, p = 1 - p) {
    out[i] = pads[p]
  }
  return out
}

function interleaveCodewords(data, version) {
  const [ecLen, g1b, g1d, g2b, g2d] = VERSION_SPEC[version]
  const dataBlocks = []
  const ecBlocks = []
  let offset = 0
  for (let i = 0; i < g1b; i++) {
    const blk = data.subarray(offset, offset + g1d)
    offset += g1d
    dataBlocks.push(blk)
    ecBlocks.push(rsComputeEC(blk, ecLen))
  }
  for (let i = 0; i < g2b; i++) {
    const blk = data.subarray(offset, offset + g2d)
    offset += g2d
    dataBlocks.push(blk)
    ecBlocks.push(rsComputeEC(blk, ecLen))
  }

  const maxDataLen = Math.max(g1d, g2d)
  const result = []
  for (let i = 0; i < maxDataLen; i++) {
    for (const blk of dataBlocks) {
      if (i < blk.length) result.push(blk[i])
    }
  }
  for (let i = 0; i < ecLen; i++) {
    for (const ec of ecBlocks) result.push(ec[i])
  }
  return Uint8Array.from(result)
}

function formatBitsForMask(mask) {
  // EC Level M = 0b00
  const data = (0b00 << 3) | (mask & 0x7)
  let rem = data << 10
  for (let i = 4; i >= 0; i--) {
    if (rem & (1 << (i + 10))) rem ^= 0x537 << i
  }
  return ((data << 10) | rem) ^ 0x5412
}

function versionBits(version) {
  let rem = version << 12
  for (let i = 5; i >= 0; i--) {
    if (rem & (1 << (i + 12))) rem ^= 0x1f25 << i
  }
  return (version << 12) | rem
}

const MASK_FNS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
]

function buildTemplate(version) {
  const size = 17 + version * 4
  // -1 = unassigned data cell, 0 = fixed white, 1 = fixed dark
  const mat = Array.from({ length: size }, () => new Int8Array(size).fill(-1))
  const set = (r, c, v) => {
    if (r >= 0 && r < size && c >= 0 && c < size) mat[r][c] = v ? 1 : 0
  }

  // Finder patterns + 1-module separators
  const drawFinder = (tr, tc) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6
        const border = dr === 0 || dr === 6 || dc === 0 || dc === 6
        const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4
        set(tr + dr, tc + dc, inside && (border || core))
      }
    }
  }
  drawFinder(0, 0)
  drawFinder(0, size - 7)
  drawFinder(size - 7, 0)

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }

  // Alignment patterns
  const coords = VERSION_SPEC[version][5]
  for (const r of coords) {
    for (const c of coords) {
      if (mat[r][c] !== -1) continue
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const d = Math.max(Math.abs(dr), Math.abs(dc))
          set(r + dr, c + dc, d === 0 || d === 2)
        }
      }
    }
  }

  // Reserve format info cells + dark module
  for (let i = 0; i <= 8; i++) {
    if (mat[8][i] === -1) mat[8][i] = 0
    if (mat[i][8] === -1) mat[i][8] = 0
  }
  for (let i = size - 8; i < size; i++) {
    if (mat[8][i] === -1) mat[8][i] = 0
    if (mat[i][8] === -1) mat[i][8] = 0
  }
  set(size - 8, 8, 1) // dark module

  // Version info blocks (V >= 7)
  if (version >= 7) {
    const vb = versionBits(version)
    for (let i = 0; i < 18; i++) {
      const bit = (vb >>> i) & 1
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(a, b, bit)
      set(b, a, bit)
    }
  }

  return mat
}

function applyFormat(mat, mask) {
  const size = mat.length
  const fb = formatBitsForMask(mask)
  const bit = (i) => (fb >>> i) & 1

  const tlRow = [0, 1, 2, 3, 4, 5, 7, 8]
  for (let idx = 0; idx < 8; idx++) {
    mat[8][tlRow[idx]] = bit(14 - idx)
  }
  const tlCol = [7, 5, 4, 3, 2, 1, 0]
  for (let idx = 0; idx < 7; idx++) {
    mat[tlCol[idx]][8] = bit(6 - idx)
  }
  for (let idx = 0; idx < 7; idx++) {
    mat[size - 1 - idx][8] = bit(14 - idx)
  }
  for (let idx = 0; idx < 8; idx++) {
    mat[8][size - 8 + idx] = bit(7 - idx)
  }
}

function placeData(template, codewords, mask) {
  const size = template.length
  const mat = template.map((row) => Int8Array.from(row))
  const maskFn = MASK_FNS[mask]
  let bitIdx = 0
  const totalBits = codewords.length * 8
  let dir = -1

  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col-- // skip vertical timing column
    for (let step = 0; step < size; step++) {
      const row = dir === -1 ? size - 1 - step : step
      for (let dx = 0; dx < 2; dx++) {
        const c = col - dx
        if (mat[row][c] !== -1) continue
        let bit = 0
        if (bitIdx < totalBits) {
          bit = (codewords[bitIdx >> 3] >>> (7 - (bitIdx & 7))) & 1
          bitIdx++
        }
        mat[row][c] = maskFn(row, c) ? bit ^ 1 : bit
      }
    }
    dir = -dir
  }
  applyFormat(mat, mask)
  return mat
}

function scoreMask(mat) {
  const n = mat.length
  let penalty = 0
  // Rule 1: runs of 5+ identical modules in rows/cols
  for (let r = 0; r < n; r++) {
    let runR = 1, runC = 1
    for (let i = 1; i < n; i++) {
      if (mat[r][i] === mat[r][i - 1]) {
        runR++
        if (runR === 5) penalty += 3
        else if (runR > 5) penalty += 1
      } else runR = 1

      if (mat[i][r] === mat[i - 1][r]) {
        runC++
        if (runC === 5) penalty += 3
        else if (runC > 5) penalty += 1
      } else runC = 1
    }
  }
  // Rule 2: 2x2 blocks of same color
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = mat[r][c]
      if (v === mat[r][c + 1] && v === mat[r + 1][c] && v === mat[r + 1][c + 1]) {
        penalty += 3
      }
    }
  }
  // Rule 4: dark/light balance
  let dark = 0
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (mat[r][c]) dark++
  const pct = (dark * 100) / (n * n)
  penalty += Math.floor(Math.abs(pct - 50) / 5) * 10
  return penalty
}

// encodeQR returns { size, version, matrix } where matrix[r][c] is 0 or 1.
export function encodeQR(text) {
  const bytes = new TextEncoder().encode(String(text))
  const version = pickVersion(bytes.length)
  const data = encodeDataCodewords(bytes, version)
  const codewords = interleaveCodewords(data, version)
  const template = buildTemplate(version)

  let best = null
  let bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    const candidate = placeData(template, codewords, mask)
    const sc = scoreMask(candidate)
    if (sc < bestScore) {
      bestScore = sc
      best = candidate
    }
  }
  return { size: best.length, version, matrix: best }
}

// qrToSvgPath builds a single crisp SVG <path> string for all dark modules
// with a quiet zone of `margin` modules.
export function qrToSvgPath(matrix, margin = 4) {
  const n = matrix.length
  const cmds = []
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        cmds.push(`M${c + margin},${r + margin}h1v1h-1z`)
      }
    }
  }
  return { path: cmds.join(''), viewBoxSize: n + margin * 2 }
}
