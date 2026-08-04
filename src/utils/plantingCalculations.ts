export type PlantingCalculationInput = {
  areaSqMeters: number
  workingWidthMeters: number
  coulterCount: number
  seedSpacingCm: number
  yieldEnabled: boolean
  yieldUnitsPerPlant: number
  grainsPerUnit: number
  weightSampleCount: number
  weightSampleGrams: number
}

export type PlantingCalculationResult = {
  rowSpacingMeters: number
  seedsPerRowMeter: number
  plantsPerSqMeter: number
  plantsPerHectare: number
  plantsInField: number
  fieldAreaHectares: number
  yieldKgPerSqMeter: number | null
  yieldTonsPerHectare: number | null
  yieldTonsInField: number | null
}

function finitePositive(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function calculatePlanting(
  input: PlantingCalculationInput,
): PlantingCalculationResult {
  const areaSqMeters = finitePositive(input.areaSqMeters)
  const width = finitePositive(input.workingWidthMeters)
  const coulters = Math.max(0, Math.floor(finitePositive(input.coulterCount)))
  const seedSpacingMeters = finitePositive(input.seedSpacingCm) / 100
  const rowSpacingMeters = width > 0 && coulters > 0 ? width / coulters : 0
  const seedsPerRowMeter = seedSpacingMeters > 0 ? 1 / seedSpacingMeters : 0
  const plantsPerSqMeter =
    rowSpacingMeters > 0 && seedSpacingMeters > 0
      ? 1 / (rowSpacingMeters * seedSpacingMeters)
      : 0
  const plantsPerHectare = plantsPerSqMeter * 10_000
  const plantsInField = plantsPerSqMeter * areaSqMeters

  let yieldKgPerSqMeter: number | null = null
  let yieldTonsPerHectare: number | null = null
  let yieldTonsInField: number | null = null

  if (input.yieldEnabled) {
    const unitsPerPlant = finitePositive(input.yieldUnitsPerPlant)
    const grainsPerUnit = finitePositive(input.grainsPerUnit)
    const sampleCount = finitePositive(input.weightSampleCount)
    const sampleWeightGrams = finitePositive(input.weightSampleGrams)
    const oneGrainGrams = sampleCount > 0 ? sampleWeightGrams / sampleCount : 0

    yieldKgPerSqMeter =
      (plantsPerSqMeter * unitsPerPlant * grainsPerUnit * oneGrainGrams) / 1000
    yieldTonsPerHectare = yieldKgPerSqMeter * 10
    yieldTonsInField = (yieldKgPerSqMeter * areaSqMeters) / 1000
  }

  return {
    rowSpacingMeters,
    seedsPerRowMeter,
    plantsPerSqMeter,
    plantsPerHectare,
    plantsInField,
    fieldAreaHectares: areaSqMeters / 10_000,
    yieldKgPerSqMeter,
    yieldTonsPerHectare,
    yieldTonsInField,
  }
}

export function formatCount(value: number) {
  if (!Number.isFinite(value)) return '0'
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: value < 100 ? 2 : 0,
  }).format(value)
}

export function formatDecimal(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}
