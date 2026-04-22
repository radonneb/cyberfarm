import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MapView from '../components/MapView'
import { useAppStore } from '../store/appStore'
import { useMapLayers } from '../appHelpers'

export default function CreateFieldPage() {
  const navigate = useNavigate()
  const {
    loadedTaskData,
    selectedFieldId,
    setSelectedFieldId,
    editorMode,
    setEditorMode,
    draftCreate,
    startCreateNewField,
    startCreateGuidanceForField,
    setDraftFieldName,
    setDraftGuidanceName,
    addDraftBoundaryPoint,
    addDraftGuidancePoint,
    commitDraftCreate,
    dataVersion,
  } = useAppStore()

  const [createMode, setCreateMode] = useState<'new' | 'existing'>('new')
  const [draftFieldId, setDraftFieldId] = useState('')
  const allFields = loadedTaskData?.fields ?? []
  const selectedField = allFields.find((field) => field.id === selectedFieldId) ?? null
  const { polygonLayer, guidanceLayer } = useMapLayers()

  const saveCreate = () => {
    if (commitDraftCreate()) {
      setEditorMode('view')
      navigate('/')
    }
  }

  return (
    <div className="content-grid work-grid compact-grid">
      <section className="page-card work-form-card compact-card">
        <div className="section-kicker compact-kicker">Create mode</div>
        <div className="seg-row compact-seg-row">
          <button className={`seg-btn-v2 compact-seg-btn ${createMode === 'new' ? 'active' : ''}`} onClick={() => setCreateMode('new')}>New field</button>
          <button className={`seg-btn-v2 compact-seg-btn ${createMode === 'existing' ? 'active' : ''}`} onClick={() => setCreateMode('existing')}>Line to existing field</button>
        </div>

        {createMode === 'new' ? (
          <>
            <label className="form-label">Field name</label>
            <input className="text-input compact-input" value={draftCreate.fieldName} onChange={(e) => setDraftFieldName(e.target.value)} />
            <label className="form-label">Guidance name</label>
            <input className="text-input compact-input" value={draftCreate.guidanceName} onChange={(e) => setDraftGuidanceName(e.target.value)} />
            <div className="hint-box compact-box">
              1) Click Start boundary. 2) Add at least 3 boundary points. 3) Click Start guidance. 4) Add at least 2 guidance points. 5) Click Save.
            </div>
            <div className="action-row compact-actions">
              <button className="ghost-btn small-btn" onClick={() => startCreateNewField(draftCreate.fieldName, draftCreate.guidanceName)}>Start boundary</button>
              <button className="ghost-btn small-btn" onClick={() => setEditorMode('drawGuidance')}>Start guidance</button>
              <button className="success-btn small-btn" onClick={saveCreate}>Save</button>
            </div>
          </>
        ) : (
          <>
            <label className="form-label">Field</label>
            <select className="text-input compact-input" value={draftFieldId} onChange={(e) => setDraftFieldId(e.target.value)}>
              <option value="">Select field</option>
              {allFields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}
            </select>
            <label className="form-label">Guidance name</label>
            <input className="text-input compact-input" value={draftCreate.guidanceName} onChange={(e) => setDraftGuidanceName(e.target.value)} />
            <div className="hint-box compact-box">Select a field, click Start guidance, place the points on the map, then save.</div>
            <div className="action-row compact-actions">
              <button className="ghost-btn small-btn" onClick={() => draftFieldId && startCreateGuidanceForField(draftFieldId, draftCreate.guidanceName)}>Start guidance</button>
              <button className="success-btn small-btn" onClick={saveCreate}>Save</button>
            </div>
          </>
        )}

        <div className="draft-info-box compact-box">
          <div>Boundary points: {draftCreate.boundaryPoints.length}</div>
          <div>Guidance points: {draftCreate.guidancePoints.length}</div>
          <div>Mode: {editorMode}</div>
        </div>
      </section>

      <section className="page-card map-card compact-card">
        <MapView
          importedLayer={polygonLayer}
          guidanceLayer={guidanceLayer}
          selectedFieldId={selectedFieldId}
          selectedField={selectedField}
          editorMode={editorMode}
          draftBoundaryPoints={draftCreate.boundaryPoints}
          draftGuidancePoints={draftCreate.guidancePoints}
          editingEnabled={false}
          onSelectField={setSelectedFieldId}
          onAddDraftPoint={(lat, lon) => {
            if (editorMode === 'drawField') addDraftBoundaryPoint(lat, lon)
            if (editorMode === 'drawGuidance') addDraftGuidancePoint(lat, lon)
          }}
          onMoveBoundaryPoint={() => {}}
          onMoveGuidancePoint={() => {}}
          dataVersion={dataVersion}
        />
      </section>
    </div>
  )
}
