import { useState } from 'react'
import MapView from '../components/MapView'
import { renderMaterialDetails, useMapLayers, type OperationType } from '../appHelpers'
import { useAppStore } from '../store/appStore'

export default function GenerateLinesPage() {
  const {
    loadedTaskData,
    selectedFieldId,
    setSelectedFieldId,
    generationResult,
    clearGenerationResult,
    generateLines,
    setErrorMessage,
    dataVersion,
  } = useAppStore()

  const [generateOperation, setGenerateOperation] = useState<OperationType>('others')
  const [generateWidth, setGenerateWidth] = useState('12')
  const [generateCrop, setGenerateCrop] = useState('Corn')
  const [generateUnits, setGenerateUnits] = useState('kg/ha')
  const [generateRate, setGenerateRate] = useState('150')
  const [generateMixtureRate, setGenerateMixtureRate] = useState('120')
  const [generateChemicalRate, setGenerateChemicalRate] = useState('200')

  const allFields = loadedTaskData?.fields ?? []
  const selectedField = allFields.find((field) => field.id === selectedFieldId) ?? null
  const { polygonLayer, guidanceLayer } = useMapLayers()

  const submitGenerate = () => {
    if (!selectedFieldId) {
      setErrorMessage('Select a field first.')
      return
    }

    generateLines({
      fieldId: selectedFieldId,
      width: Number(generateWidth) || 0,
      operation: generateOperation,
      crop: generateCrop,
      units: generateUnits,
      rate: Number(generateRate) || 0,
      mixtureRate: Number(generateMixtureRate) || 0,
      chemicalRate: Number(generateChemicalRate) || 0,
    })
  }

  return (
    <div className="content-grid generate-grid-v2">
      <section className="page-card work-form-card compact-card left-panel-card scroll-panel">
        <div className="section-kicker compact-kicker">Generation setup</div>
        <label className="form-label">Field</label>
        <select className="text-input compact-input" value={selectedFieldId ?? ''} onChange={(e) => setSelectedFieldId(e.target.value || null)}>
          <option value="">Select field</option>
          {allFields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}
        </select>

        <label className="form-label">Working width, m</label>
        <input className="text-input compact-input" value={generateWidth} onChange={(e) => setGenerateWidth(e.target.value)} />

        <label className="form-label">Operation</label>
        <select className="text-input compact-input" value={generateOperation} onChange={(e) => setGenerateOperation(e.target.value as OperationType)}>
          <option value="seeding">Seeding</option>
          <option value="fertilizing">Fertilizing</option>
          <option value="spraying">Spraying</option>
          <option value="others">Others</option>
        </select>

        {generateOperation === 'seeding' && (
          <>
            <label className="form-label">Crop</label>
            <select className="text-input compact-input" value={generateCrop} onChange={(e) => setGenerateCrop(e.target.value)}>
              {['Corn', 'Soya', 'Sunflower', 'Wheat', 'Barley', 'Sugarbeet'].map((crop) => <option key={crop}>{crop}</option>)}
            </select>
            <label className="form-label">Units</label>
            <select className="text-input compact-input" value={generateUnits} onChange={(e) => setGenerateUnits(e.target.value)}>
              <option value="kg/ha">kg/ha</option>
              <option value="TK/ha">TK/ha</option>
            </select>
            <label className="form-label">Rate</label>
            <input className="text-input compact-input" value={generateRate} onChange={(e) => setGenerateRate(e.target.value)} />
          </>
        )}

        {generateOperation === 'fertilizing' && (
          <>
            <label className="form-label">Rate kg/ha</label>
            <input className="text-input compact-input" value={generateRate} onChange={(e) => setGenerateRate(e.target.value)} />
          </>
        )}

        {generateOperation === 'spraying' && (
          <>
            <label className="form-label">Mixture L/ha</label>
            <input className="text-input compact-input" value={generateMixtureRate} onChange={(e) => setGenerateMixtureRate(e.target.value)} />
            <label className="form-label">Chemical g/ha</label>
            <input className="text-input compact-input" value={generateChemicalRate} onChange={(e) => setGenerateChemicalRate(e.target.value)} />
          </>
        )}

        <div className="action-row compact-actions sticky-actions">
          <button className="primary-btn small-btn" onClick={submitGenerate}>Generate</button>
          <button className="ghost-btn small-btn" onClick={clearGenerationResult}>Clear</button>
        </div>
      </section>

      <section className="page-card map-card main-map-card compact-card">
        <MapView
          importedLayer={polygonLayer}
          guidanceLayer={guidanceLayer}
          selectedFieldId={selectedFieldId}
          selectedField={selectedField}
          editorMode="view"
          draftBoundaryPoints={[]}
          draftGuidancePoints={[]}
          editingEnabled={false}
          onSelectField={setSelectedFieldId}
          onAddDraftPoint={() => {}}
          onMoveBoundaryPoint={() => {}}
          onMoveGuidancePoint={() => {}}
          dataVersion={dataVersion}
        />
      </section>

      <section className="page-card generation-results-card compact-card right-panel-card scroll-panel">
        <div className="section-kicker compact-kicker">Generated lines</div>
        {generationResult ? (
          <>
            <div className="generation-summary-top compact-box sticky-summary">
              <div className="summary-main-row">
                <div className="summary-pill"><span>Lines</span><strong>{generationResult.totalLines}</strong></div>
                <div className="summary-pill summary-pill-wide"><span>Total materials</span><strong>{generationResult.totalMaterialSummary}</strong></div>
              </div>
              <div className="summary-sub-row">
                <span>Length: {generationResult.totalLengthMeters.toFixed(1)} m</span>
                <span>Area: {generationResult.totalAreaHectares.toFixed(3)} ha</span>
                <span>Width: {generationResult.widthMeters.toFixed(2)} m</span>
              </div>
            </div>

            <div className="generation-results-scroll scroll-area">
              {generationResult.lines.map((line) => (
                <div key={line.id} className="info-block result-block">
                  <div className="info-block-title">
                    <strong>Line {line.name}</strong>
                    <span>{line.lengthMeters.toFixed(1)} m</span>
                  </div>
                  <div className="result-detail">Index: {line.lineIndex > 0 ? `+${line.lineIndex}` : `${line.lineIndex}`}</div>
                  <div className="result-detail">Area: {line.areaHectares.toFixed(4)} ha</div>
                  {renderMaterialDetails(line)}
                </div>
              ))}
            </div>
          </>
        ) : <div className="empty-panel small">Generate lines to see the summary and per-line calculations here.</div>}
      </section>
    </div>
  )
}
