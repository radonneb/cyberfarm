import assert from 'node:assert/strict'

const US_BUSHEL_TO_LITERS = 35.23907016688
const DEFAULT_TANK_HEIGHT_CM = 160
const DEFAULT_BOTTOM_AREA_RATIO = 0.45

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function adjustedDensity(baseDensity, baseMoisture, enteredMoisture) {
  return baseDensity * ((100 - baseMoisture) / (100 - enteredMoisture))
}

function tankVolumeFractionByHeight(
  heightCm,
  totalHeightCm = DEFAULT_TANK_HEIGHT_CM,
  bottomAreaRatio = DEFAULT_BOTTOM_AREA_RATIO,
) {
  const x = clamp(heightCm / totalHeightCm, 0, 1)
  const denominator = bottomAreaRatio + 0.5 * (1 - bottomAreaRatio)
  const numerator = bottomAreaRatio * x + 0.5 * (1 - bottomAreaRatio) * x * x
  return numerator / denominator
}

const simpleVolume = 400 * US_BUSHEL_TO_LITERS
const simpleDensity = adjustedDensity(772, 14.5, 14.5)
const simpleTons = (simpleVolume / 1000) * simpleDensity / 1000

assert.ok(Math.abs(simpleVolume - 14095.628066752) < 0.000001)
assert.ok(Math.abs(simpleTons - 10.881824867532544) < 0.000001)

const halfHeightFraction = tankVolumeFractionByHeight(80, 160, 0.45)
assert.ok(halfHeightFraction < 0.5 && halfHeightFraction > 0.35)

const effectiveVolumeL = 14100 * tankVolumeFractionByHeight(160)
const actualMass = (effectiveVolumeL / 1000) * 772 / 1000
const calibrationFactorMass = actualMass * 0.95
const fieldYieldTonsPerHa = actualMass / 1.5
const fieldValue = fieldYieldTonsPerHa * 70
const cleanMass = actualMass * 0.98
const standardMass = cleanMass * ((100 - 14.5) / (100 - 14.5))
const waterLoss = cleanMass - standardMass

assert.ok(Math.abs(actualMass - 10.8852) < 0.000001)
assert.ok(Math.abs(calibrationFactorMass - 10.34094) < 0.000001)
assert.ok(Math.abs(fieldValue - 507.976) < 0.000001)
assert.ok(Math.abs(fieldYieldTonsPerHa - 7.2568) < 0.000001)
assert.ok(Math.abs(cleanMass - 10.667496) < 0.000001)
assert.ok(Math.abs(waterLoss) < 0.000001)

console.log('Grain Bunker source-formula verification passed (10 checks).')
