import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { encodeQR, qrToSvgPath, rsComputeEC } from './qrcode.js'

describe('qrcode', () => {
  it('computes known Reed-Solomon EC codewords for Version 1-M', () => {
    // Standard ISO/IEC 18004 example: "HELLO WORLD" in byte mode won't match
    // alphanumeric, so verify RS invariant: polynomial evaluated at alpha^0..alpha^(ecLen-1) == 0.
    const data = Uint8Array.from([0x40, 0xd2, 0x75, 0x47, 0x76, 0x17, 0x32, 0x06, 0x27, 0x26, 0x96, 0xc6, 0xc6, 0x96, 0x70, 0xec])
    const ec = rsComputeEC(data, 10)
    assert.equal(ec.length, 10)
    // Re-encoding data+ec through rsComputeEC yields all zeros if valid
    const full = new Uint8Array(data.length + ec.length)
    full.set(data, 0)
    full.set(ec, data.length)
    const check = rsComputeEC(full, 10)
    assert.deepEqual([...check], new Array(10).fill(0))
  })

  it('encodes an otpauth TOTP URI into a valid QR matrix', () => {
    const uri = 'otpauth://totp/SuperDash:admin?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=SuperDash'
    const { size, version, matrix } = encodeQR(uri)
    assert.ok(version >= 5 && version <= 7, `expected version 5-7, got ${version}`)
    assert.equal(size, 17 + version * 4)

    // Verify all 3 finder patterns have solid 7x7 outer ring & 3x3 center
    for (const [tr, tc] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      for (let i = 0; i < 7; i++) {
        assert.equal(matrix[tr][tc + i], 1)
        assert.equal(matrix[tr + 6][tc + i], 1)
        assert.equal(matrix[tr + i][tc], 1)
        assert.equal(matrix[tr + i][tc + 6], 1)
      }
      assert.equal(matrix[tr + 3][tc + 3], 1)
      assert.equal(matrix[tr + 1][tc + 1], 0)
    }

    // Dark module at (size-8, 8)
    assert.equal(matrix[size - 8][8], 1)

    // Timing patterns alternate
    for (let i = 8; i < size - 8; i++) {
      assert.equal(matrix[6][i], i % 2 === 0 ? 1 : 0)
      assert.equal(matrix[i][6], i % 2 === 0 ? 1 : 0)
    }

    // SVG path generation produces non-empty viewBox
    const svg = qrToSvgPath(matrix, 4)
    assert.equal(svg.viewBoxSize, size + 8)
    assert.ok(svg.path.length > 100)
  })

  it('supports version 7+ payloads with version info blocks', () => {
    const longUri = 'otpauth://totp/SuperDash:admin?secret=' + 'A'.repeat(64) + '&issuer=SuperDashHomelab&algorithm=SHA1&digits=6&period=30'
    const { version, size } = encodeQR(longUri)
    assert.ok(version >= 7, `expected version >= 7, got ${version}`)
    assert.equal(size, 17 + version * 4)
  })
})
