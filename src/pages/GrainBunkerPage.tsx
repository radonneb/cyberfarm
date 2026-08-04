import { useMemo, useState } from 'react'
import { fieldAreaSqMeters } from '../appHelpers'
import {
  combines,
  crops,
  yieldBenchmarks,
  type CropId,
  type GrainProfile,
} from '../data/grainBunkerData'
import { useAppStore } from '../store/appStore'

const US_BUSHEL_TO_LITERS = 35.23907016688
const DEFAULT_TANK_HEIGHT_CM = 160
const DEFAULT_BOTTOM_AREA_RATIO = 0.45

type SimpleResult = {
  cropId: CropId
  cropName: string
  profile: GrainProfile
  bushels: number
  volumeL: number
  moisture: number
  density: number
  tons: number
  low: number
  high: number
}

type AdvancedResult = {
  cropId: CropId
  cropName: string
  profile: GrainProfile
  combineName: string
  volumeL: number
  sensorHeightCm: number
  fillPercent: number
  moisture: number
  impurity: number
  calibration: number
  fieldAreaHa: number
  fillPathHa: number
  grainHeightCm: number
  volumeFraction: number
  effectiveVolumeL: number
  density: number
  actualMass: number
  calibrationFactorMass: number
  cleanMass: number
  standardMass: number
  waterLoss: number
  fieldYieldTonsPerHa: number
  fieldValue: number
  ratingScore: number
  ratingStars: string
  ratingSource: string
  low: number
  high: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function format(value: number, digits = 2) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

function adjustedDensity(baseDensity: number, baseMoisture: number, enteredMoisture: number) {
  return baseDensity * ((100 - baseMoisture) / (100 - enteredMoisture))
}

function tankVolumeFractionByHeight(
  heightCm: number,
  totalHeightCm = DEFAULT_TANK_HEIGHT_CM,
  bottomAreaRatio = DEFAULT_BOTTOM_AREA_RATIO,
) {
  const x = clamp(heightCm / totalHeightCm, 0, 1)
  const denominator = bottomAreaRatio + 0.5 * (1 - bottomAreaRatio)
  const numerator = bottomAreaRatio * x + 0.5 * (1 - bottomAreaRatio) * x * x
  return numerator / denominator
}

function calculateYieldRating(cropId: CropId, yieldTonsPerHa: number) {
  const benchmark = yieldBenchmarks[cropId]
  let score: number

  if (!Number.isFinite(yieldTonsPerHa) || yieldTonsPerHa <= 0) {
    score = 1
  } else if (yieldTonsPerHa <= benchmark.average) {
    score = 1 + 4 * ((yieldTonsPerHa - benchmark.min) / (benchmark.average - benchmark.min))
  } else {
    score = 5 + 5 * ((yieldTonsPerHa - benchmark.average) / (benchmark.max - benchmark.average))
  }

  score = clamp(score, 1, 10)
  const rounded = clamp(Math.round(score), 1, 10)
  return {
    score,
    stars: `${'★'.repeat(rounded)}${'☆'.repeat(10 - rounded)}`,
    source: benchmark.source,
  }
}

function defaultProfile(cropId: CropId) {
  const crop = crops[cropId]
  return crop.profiles.find((profile) => profile.id === crop.defaultProfile) ?? crop.profiles[0]
}

function downloadText(fileName: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function timestampName() {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

export default function GrainBunkerPage() {
  const { loadedTaskData, selectedFieldId, setSelectedFieldId } = useAppStore()
  const fields = loadedTaskData?.fields ?? []
  const selectedField = fields.find((field) => field.id === selectedFieldId) ?? null
  const selectedAreaHa = selectedField ? fieldAreaSqMeters(selectedField) / 10_000 : 70

  const [mode, setMode] = useState<'simple' | 'advanced'>('simple')

  const [simpleBushels, setSimpleBushels] = useState(400)
  const [simpleCropId, setSimpleCropId] = useState<CropId>('wheat')
  const [simpleMoisture, setSimpleMoisture] = useState(crops.wheat.baseMoisture)
  const [simpleResult, setSimpleResult] = useState<SimpleResult | null>(null)
  const [simpleError, setSimpleError] = useState<string | null>(null)

  const [combineId, setCombineId] = useState('jd_s790')
  const [volumeL, setVolumeL] = useState(14_100)
  const [sensorHeightCm, setSensorHeightCm] = useState(150)
  const [fillPercent, setFillPercent] = useState(100)
  const [advancedCropId, setAdvancedCropId] = useState<CropId>('wheat')
  const [profileId, setProfileId] = useState(crops.wheat.defaultProfile)
  const [advancedMoisture, setAdvancedMoisture] = useState(crops.wheat.baseMoisture)
  const [impurity, setImpurity] = useState(2)
  const [calibration, setCalibration] = useState(1)
  const [fieldAreaHa, setFieldAreaHa] = useState(selectedAreaHa || 70)
  const [fillPathHa, setFillPathHa] = useState(1.5)
  const [advancedResult, setAdvancedResult] = useState<AdvancedResult | null>(null)
  const [advancedError, setAdvancedError] = useState<string | null>(null)

  const advancedProfiles = crops[advancedCropId].profiles
  const selectedProfile = useMemo(
    () => advancedProfiles.find((profile) => profile.id === profileId) ?? advancedProfiles[0],
    [advancedProfiles, profileId],
  )

  const calculateSimple = () => {
    if (!(simpleBushels > 0 && simpleBushels <= 1000 && simpleMoisture > 0 && simpleMoisture < 45)) {
      setSimpleError('Tank volume must be above 0 and moisture must be between 0% and 45%.')
      setSimpleResult(null)
      return
    }

    const crop = crops[simpleCropId]
    const profile = defaultProfile(simpleCropId)
    const calculatedVolumeL = simpleBushels * US_BUSHEL_TO_LITERS
    const density = adjustedDensity(profile.density, crop.baseMoisture, simpleMoisture)
    const tons = (calculatedVolumeL / 1000) * density / 1000

    setSimpleError(null)
    setSimpleResult({
      cropId: simpleCropId,
      cropName: crop.name,
      profile,
      bushels: simpleBushels,
      volumeL: calculatedVolumeL,
      moisture: simpleMoisture,
      density,
      tons,
      low: tons * (1 - crop.tolerance),
      high: tons * (1 + crop.tolerance),
    })
  }

  const calculateAdvanced = () => {
    const valid =
      volumeL > 0 && volumeL < 50_000 &&
      sensorHeightCm > 0 && sensorHeightCm <= DEFAULT_TANK_HEIGHT_CM &&
      fillPercent > 0 && fillPercent <= 100 &&
      advancedMoisture > 0 && advancedMoisture < 45 &&
      impurity >= 0 && impurity <= 50 &&
      calibration > 0 && calibration <= 2 &&
      fieldAreaHa > 0 && fieldAreaHa <= 10_000 &&
      fillPathHa > 0 && fillPathHa <= 1000

    if (!valid) {
      setAdvancedError('Check tank, sensor, fill, moisture, impurities, calibration and area values.')
      setAdvancedResult(null)
      return
    }

    const crop = crops[advancedCropId]
    const profile = selectedProfile
    const grainHeightCm = sensorHeightCm * (fillPercent / 100)
    const volumeFraction = tankVolumeFractionByHeight(grainHeightCm)
    const effectiveVolumeL = volumeL * volumeFraction
    const density = adjustedDensity(profile.density, crop.baseMoisture, advancedMoisture)
    const actualMass = (effectiveVolumeL / 1000) * density / 1000 * calibration
    const calibrationFactorMass = actualMass * 0.95
    const fieldYieldTonsPerHa = actualMass / fillPathHa
    const fieldValue = fieldYieldTonsPerHa * fieldAreaHa
    const rating = calculateYieldRating(advancedCropId, fieldYieldTonsPerHa)
    const cleanMass = actualMass * (1 - impurity / 100)
    const standardMass = cleanMass * ((100 - advancedMoisture) / (100 - crop.baseMoisture))
    const waterLoss = cleanMass - standardMass
    const combine = combines.find((item) => item.id === combineId)

    setAdvancedError(null)
    setAdvancedResult({
      cropId: advancedCropId,
      cropName: crop.name,
      profile,
      combineName: combine?.name ?? 'Custom volume',
      volumeL,
      sensorHeightCm,
      fillPercent,
      moisture: advancedMoisture,
      impurity,
      calibration,
      fieldAreaHa,
      fillPathHa,
      grainHeightCm,
      volumeFraction,
      effectiveVolumeL,
      density,
      actualMass,
      calibrationFactorMass,
      cleanMass,
      standardMass,
      waterLoss,
      fieldYieldTonsPerHa,
      fieldValue,
      ratingScore: rating.score,
      ratingStars: rating.stars,
      ratingSource: rating.source,
      low: actualMass * (1 - crop.tolerance),
      high: actualMass * (1 + crop.tolerance),
    })
  }

  const resetSimple = () => {
    setSimpleBushels(400)
    setSimpleCropId('wheat')
    setSimpleMoisture(crops.wheat.baseMoisture)
    setSimpleResult(null)
    setSimpleError(null)
  }

  const resetAdvanced = () => {
    setCombineId('jd_s790')
    setVolumeL(14_100)
    setSensorHeightCm(150)
    setFillPercent(100)
    setAdvancedCropId('wheat')
    setProfileId(crops.wheat.defaultProfile)
    setAdvancedMoisture(crops.wheat.baseMoisture)
    setImpurity(2)
    setCalibration(1)
    setFieldAreaHa(selectedAreaHa || 70)
    setFillPathHa(1.5)
    setAdvancedResult(null)
    setAdvancedError(null)
  }

  const exportCalculation = () => {
    const now = new Date()
    if (mode === 'simple' && simpleResult) {
      const text = [
        'CYBERFARM — GRAIN BUNKER CALCULATION',
        '',
        `Date: ${now.toLocaleString('en-GB')}`,
        'Mode: Simple',
        `Crop: ${simpleResult.cropName}`,
        `Profile: ${simpleResult.profile.name}`,
        `Tank volume: ${format(simpleResult.bushels, 2)} bu / ${format(simpleResult.volumeL, 0)} L`,
        `Moisture: ${format(simpleResult.moisture, 1)}%`,
        `Adjusted density: ${format(simpleResult.density, 2)} kg/m³`,
        '',
        `Estimated mass: ${format(simpleResult.tons, 3)} t`,
        `Possible range: ${format(simpleResult.low, 3)}–${format(simpleResult.high, 3)} t`,
        '',
        'FORMULA',
        `Volume = ${format(simpleResult.bushels, 2)} × ${US_BUSHEL_TO_LITERS} L/bu`,
        `Density = ${simpleResult.profile.density} × (100 - ${crops[simpleResult.cropId].baseMoisture}) / (100 - ${simpleResult.moisture})`,
        'Mass = volume m³ × density kg/m³ ÷ 1000',
      ].join('\n')
      downloadText(`grain-bunker-${timestampName()}.txt`, text)
      return
    }

    if (mode === 'advanced' && advancedResult) {
      const text = [
        'CYBERFARM — GRAIN BUNKER CALCULATION',
        '',
        `Date: ${now.toLocaleString('en-GB')}`,
        'Mode: Advanced',
        `Field: ${selectedField?.name ?? 'Manual area'}`,
        `Field area: ${format(advancedResult.fieldAreaHa, 2)} ha`,
        '',
        `Combine: ${advancedResult.combineName}`,
        `Tank volume: ${format(advancedResult.volumeL, 0)} L`,
        `Sensor height: ${format(advancedResult.sensorHeightCm, 1)} cm`,
        `Fill factor: ${format(advancedResult.fillPercent, 1)}%`,
        `Crop: ${advancedResult.cropName}`,
        `Profile: ${advancedResult.profile.name}`,
        `Moisture: ${format(advancedResult.moisture, 1)}%`,
        `Impurities: ${format(advancedResult.impurity, 1)}%`,
        `Calibration coefficient: ${format(advancedResult.calibration, 3)}`,
        `Fill path: ${format(advancedResult.fillPathHa, 2)} ha`,
        '',
        `Effective volume: ${format(advancedResult.effectiveVolumeL, 0)} L`,
        `Adjusted density: ${format(advancedResult.density, 2)} kg/m³`,
        `Actual mass: ${format(advancedResult.actualMass, 3)} t`,
        `Clean mass: ${format(advancedResult.cleanMass, 3)} t`,
        `Standard dry mass: ${format(advancedResult.standardMass, 3)} t`,
        `Water loss: ${format(advancedResult.waterLoss, 3)} t`,
        `Possible range: ${format(advancedResult.low, 3)}–${format(advancedResult.high, 3)} t`,
        `Yield by bunker: ${format(advancedResult.fieldYieldTonsPerHa, 3)} t/ha`,
        `Estimated full-field value: ${format(advancedResult.fieldValue, 2)} t`,
        `Field rating: ${format(advancedResult.ratingScore, 1)}/10 ${advancedResult.ratingStars}`,
        '',
        'CALCULATION DETAILS',
        `Grain height = ${format(advancedResult.sensorHeightCm, 1)} × ${format(advancedResult.fillPercent, 1)}% = ${format(advancedResult.grainHeightCm, 2)} cm`,
        `Tank volume fraction = ${format(advancedResult.volumeFraction * 100, 3)}%`,
        `Actual mass = effective volume × adjusted density × calibration`,
        `Clean mass = actual mass × (1 - impurities / 100)`,
        `Standard mass = clean mass × (100 - entered moisture) / (100 - base moisture)`,
        `Compatibility factor from source calculator: ${format(advancedResult.calibrationFactorMass, 3)} t (95% of actual mass)`,
        `Rating reference label from source calculator: ${advancedResult.ratingSource}`,
        '',
        'This is an estimator. Verify the result against certified scale measurements before operational use.',
      ].join('\n')
      downloadText(`grain-bunker-${timestampName()}.txt`, text)
    }
  }

  return (
    <div className="bunker-layout">
      <section className="page-card bunker-input-card scroll-panel">
        <div className="section-kicker">Grain Bunker</div>
        <h2 className="section-title">Tank mass estimator</h2>
        <div className="seg-row">
          <button className={`seg-btn-v2 ${mode === 'simple' ? 'active' : ''}`} onClick={() => setMode('simple')}>Simple</button>
          <button className={`seg-btn-v2 ${mode === 'advanced' ? 'active' : ''}`} onClick={() => setMode('advanced')}>Advanced</button>
        </div>

        {mode === 'simple' ? (
          <>
            <label className="form-label">Tank volume, bushels</label>
            <input className="text-input" type="number" min="1" max="1000" value={simpleBushels} onChange={(event) => setSimpleBushels(Number(event.target.value))} />

            <label className="form-label">Crop</label>
            <select
              className="text-input"
              value={simpleCropId}
              onChange={(event) => {
                const cropId = event.target.value as CropId
                setSimpleCropId(cropId)
                setSimpleMoisture(crops[cropId].baseMoisture)
              }}
            >
              {(Object.keys(crops) as CropId[]).map((cropId) => <option key={cropId} value={cropId}>{crops[cropId].name}</option>)}
            </select>

            <label className="form-label">Moisture, %</label>
            <input className="text-input" type="number" min="0.1" max="44.9" step="0.1" value={simpleMoisture} onChange={(event) => setSimpleMoisture(Number(event.target.value))} />

            {simpleError && <div className="inline-alert danger-alert">{simpleError}</div>}
            <div className="action-row">
              <button className="primary-btn" onClick={calculateSimple}>Calculate</button>
              <button className="ghost-btn" onClick={resetSimple}>Reset</button>
            </div>
          </>
        ) : (
          <>
            <label className="form-label">Field area source</label>
            <select
              className="text-input"
              value={selectedField?.id ?? ''}
              onChange={(event) => {
                const id = event.target.value || null
                setSelectedFieldId(id)
                const field = fields.find((item) => item.id === id)
                if (field) setFieldAreaHa(fieldAreaSqMeters(field) / 10_000)
              }}
            >
              <option value="">Manual area</option>
              {fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}
            </select>

            <label className="form-label">Field area, ha</label>
            <input className="text-input" type="number" min="0.01" max="10000" step="0.01" value={fieldAreaHa} onChange={(event) => setFieldAreaHa(Number(event.target.value))} />

            <label className="form-label">Combine</label>
            <select
              className="text-input"
              value={combineId}
              onChange={(event) => {
                const id = event.target.value
                setCombineId(id)
                const combine = combines.find((item) => item.id === id)
                if (combine && !combine.custom) setVolumeL(combine.volumeL)
              }}
            >
              {combines.map((combine) => <option key={combine.id} value={combine.id}>{combine.name}</option>)}
            </select>

            <label className="form-label">Tank volume, L</label>
            <input className="text-input" type="number" min="1000" max="50000" value={volumeL} onChange={(event) => {
              setVolumeL(Number(event.target.value))
              setCombineId('custom')
            }} />

            <div className="bunker-two-column">
              <label><span className="form-label">Sensor height, cm</span><input className="text-input" type="number" min="1" max="160" value={sensorHeightCm} onChange={(event) => setSensorHeightCm(Number(event.target.value))} /></label>
              <label><span className="form-label">Fill factor, %</span><input className="text-input" type="number" min="1" max="100" value={fillPercent} onChange={(event) => setFillPercent(Number(event.target.value))} /></label>
            </div>

            <div className="bunker-fill-presets">
              {[25, 50, 75, 100].map((value) => <button key={value} className={fillPercent === value ? 'active' : ''} onClick={() => setFillPercent(value)}>{value}%</button>)}
            </div>

            <label className="form-label">Crop</label>
            <select
              className="text-input"
              value={advancedCropId}
              onChange={(event) => {
                const cropId = event.target.value as CropId
                setAdvancedCropId(cropId)
                setProfileId(crops[cropId].defaultProfile)
                setAdvancedMoisture(crops[cropId].baseMoisture)
              }}
            >
              {(Object.keys(crops) as CropId[]).map((cropId) => <option key={cropId} value={cropId}>{crops[cropId].name}</option>)}
            </select>

            <label className="form-label">Grain profile</label>
            <select className="text-input" value={profileId} onChange={(event) => setProfileId(event.target.value)}>
              {advancedProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} — {profile.density} kg/m³</option>)}
            </select>

            <div className="bunker-two-column">
              <label><span className="form-label">Moisture, %</span><input className="text-input" type="number" min="0.1" max="44.9" step="0.1" value={advancedMoisture} onChange={(event) => setAdvancedMoisture(Number(event.target.value))} /></label>
              <label><span className="form-label">Impurities, %</span><input className="text-input" type="number" min="0" max="50" step="0.1" value={impurity} onChange={(event) => setImpurity(Number(event.target.value))} /></label>
            </div>

            <div className="bunker-two-column">
              <label><span className="form-label">Calibration</span><input className="text-input" type="number" min="0.3" max="2" step="0.001" value={calibration} onChange={(event) => setCalibration(Number(event.target.value))} /></label>
              <label><span className="form-label">Fill path, ha</span><input className="text-input" type="number" min="0.01" max="1000" step="0.01" value={fillPathHa} onChange={(event) => setFillPathHa(Number(event.target.value))} /></label>
            </div>

            {advancedError && <div className="inline-alert danger-alert">{advancedError}</div>}
            <div className="action-row">
              <button className="primary-btn" onClick={calculateAdvanced}>Calculate</button>
              <button className="ghost-btn" onClick={resetAdvanced}>Reset</button>
            </div>
          </>
        )}
      </section>

      <section className="page-card bunker-results-card scroll-panel">
        <div className="bunker-result-heading">
          <div>
            <span className="section-kicker">Calculated result</span>
            <h2>{mode === 'simple' ? 'Full-tank estimate' : 'Advanced estimate'}</h2>
          </div>
          <button
            className="secondary-btn"
            onClick={exportCalculation}
            disabled={mode === 'simple' ? !simpleResult : !advancedResult}
          >
            Export TXT
          </button>
        </div>

        {mode === 'simple' ? (
          simpleResult ? (
            <>
              <div className="bunker-primary-result">
                <span>Estimated grain mass</span>
                <strong>{format(simpleResult.tons, 3)} t</strong>
                <small>{simpleResult.cropName} · {simpleResult.profile.name}</small>
              </div>
              <div className="bunker-metric-grid">
                <div className="metric-card"><span>Possible range</span><strong>{format(simpleResult.low, 3)}–{format(simpleResult.high, 3)} t</strong></div>
                <div className="metric-card"><span>Adjusted density</span><strong>{format(simpleResult.density, 2)} kg/m³</strong></div>
                <div className="metric-card"><span>Moisture</span><strong>{format(simpleResult.moisture, 1)}%</strong></div>
                <div className="metric-card"><span>Tank volume</span><strong>{format(simpleResult.volumeL, 0)} L</strong></div>
              </div>
              <pre className="bunker-formula-block">{`Volume = ${format(simpleResult.bushels, 2)} bu × ${US_BUSHEL_TO_LITERS} L/bu\nDensity = ${simpleResult.profile.density} × (100 - ${crops[simpleResult.cropId].baseMoisture}) / (100 - ${simpleResult.moisture})\nMass = volume (m³) × density (kg/m³) ÷ 1000`}</pre>
            </>
          ) : <div className="empty-panel">Enter data and calculate.</div>
        ) : (
          advancedResult ? (
            <>
              <div className="bunker-primary-result">
                <span>Actual grain tank mass</span>
                <strong>{format(advancedResult.actualMass, 3)} t</strong>
                <small>{advancedResult.combineName} · {advancedResult.cropName}</small>
              </div>
              <div className="bunker-metric-grid">
                <div className="metric-card"><span>Clean mass</span><strong>{format(advancedResult.cleanMass, 3)} t</strong></div>
                <div className="metric-card"><span>Standard dry mass</span><strong>{format(advancedResult.standardMass, 3)} t</strong></div>
                <div className="metric-card"><span>Water loss</span><strong>{format(advancedResult.waterLoss, 3)} t</strong></div>
                <div className="metric-card"><span>Possible range</span><strong>{format(advancedResult.low, 3)}–{format(advancedResult.high, 3)} t</strong></div>
                <div className="metric-card"><span>Effective volume</span><strong>{format(advancedResult.effectiveVolumeL, 0)} L</strong></div>
                <div className="metric-card"><span>Adjusted density</span><strong>{format(advancedResult.density, 2)} kg/m³</strong></div>
                <div className="metric-card"><span>Yield by bunker</span><strong>{format(advancedResult.fieldYieldTonsPerHa, 3)} t/ha</strong></div>
                <div className="metric-card"><span>Estimated field value</span><strong>{format(advancedResult.fieldValue, 2)} t</strong></div>
                <div className="metric-card wide"><span>Field rating</span><strong>{format(advancedResult.ratingScore, 1)}/10</strong><small>{advancedResult.ratingStars}</small></div>
              </div>
              <pre className="bunker-formula-block">{`Grain height = sensor height × fill factor = ${format(advancedResult.grainHeightCm, 2)} cm\nTank fraction = ${format(advancedResult.volumeFraction * 100, 3)}%\nActual mass = effective volume × adjusted density × calibration\nClean mass = actual mass × (1 - impurities / 100)\nStandard mass = clean mass × (100 - moisture) / (100 - base moisture)\nSource compatibility factor (95%) = ${format(advancedResult.calibrationFactorMass, 3)} t`}</pre>
              <div className="bunker-estimator-note">
                This calculation preserves the original estimator formulas and density profiles. Verify operational results against certified scale measurements.
              </div>
            </>
          ) : <div className="empty-panel">Enter advanced data and calculate.</div>
        )}
      </section>
    </div>
  )
}
