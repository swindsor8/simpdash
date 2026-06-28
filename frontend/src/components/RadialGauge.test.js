// Self-check for the RadialGauge geometry. Run: node src/components/RadialGauge.test.js
// The component can't be imported in plain node (JSX + React), so the few pure
// formulas it uses are mirrored here. What matters and is easy to get wrong: the
// needle must point at the SAME angle the arc fills to (a sign/offset slip would
// render a plausible-but-wrong dial that's invisible without a browser).
import assert from 'node:assert/strict'

const CX = 50, CY = 50, R = 42, START = 135, SWEEP = 270
const polar = (deg) => [CX + R * Math.cos(deg * Math.PI / 180), CY + R * Math.sin(deg * Math.PI / 180)]

// Where the arc fills to at fraction f (y-down degrees), normalised to [0,360).
const arcAngle = (f) => (START + SWEEP * f) % 360
// The needle is drawn pointing up (base angle 270° in y-down) then CSS-rotated.
const needleRot = (f) => 270 * f - 135
const needleAngle = (f) => (270 + needleRot(f) + 360) % 360

for (const f of [0, 0.25, 0.5, 0.75, 1]) {
  assert.ok(Math.abs(needleAngle(f) - arcAngle(f)) < 1e-9, `needle≠arc at f=${f}`)
}

// Endpoints: f=0 → arc start (lower-left), f=1 → arc end (lower-right). Gap at bottom.
const [sx, sy] = polar(arcAngle(0))
const [ex, ey] = polar(arcAngle(1))
assert.ok(sx < CX && sy > CY, 'start should be lower-left')
assert.ok(ex > CX && ey > CY, 'end should be lower-right')

// Fill fraction → dashoffset (pathLength normalised to 100): 0%→100, 100%→0.
const offset = (f) => 100 - f * 100
assert.equal(offset(0), 100)
assert.equal(offset(1), 0)
assert.equal(offset(0.5), 50)

console.log('RadialGauge geometry OK')
