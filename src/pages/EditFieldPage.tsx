import MapView from '../components/MapView'
import { useAppStore } from '../store/appStore'
import { useMapLayers } from '../appHelpers'

export default function EditFieldPage() {
  const {
    loadedTaskData,
    selectedFieldId,
    setSelectedFieldId,
    updateFieldName,
    deleteField,
    deleteBoundary,
    deleteGuidance,
    updateBoundaryPoint,
    addBoundaryPoint,
    deleteBoundaryPoint,
    updateGuidanceName,
    updateGuidancePoint,
    addGuidancePoint,
    saveCurrentTaskData,
    dataVersion,
  } = useAppStore()

  const allFields = loadedTaskData?.fields ?? []
  const selectedField = allFields.find((field) => field.id === selectedFieldId) ?? null
  const { polygonLayer, guidanceLayer } = useMapLayers()

  const saveAll = () => {
    if (saveCurrentTaskData()) alert('Changes saved')
  }

  return (
    <div className="content-grid edit-grid-v2">
      <section className="page-card work-form-card editor-scroll-card compact-card left-panel-card scroll-panel">
        <div className="section-kicker compact-kicker">Field editor</div>
        <label className="form-label">Select field</label>
        <select className="text-input compact-input" value={selectedFieldId ?? ''} onChange={(e) => setSelectedFieldId(e.target.value || null)}>
          <option value="">Select field</option>
          {allFields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}
        </select>

        {selectedField ? (
          <>
            <label className="form-label">Field name</label>
            <input className="text-input compact-input" value={selectedField.name} onChange={(e) => updateFieldName(selectedField.id, e.target.value)} />
            <div className="action-row compact-actions sticky-actions">
              <button className="ghost-btn small-btn" onClick={saveAll}>Save</button>
              <button className="danger-btn small-btn" onClick={() => deleteField(selectedField.id)}>Delete field</button>
            </div>

            {selectedField.guidanceLines.map((line) => (
              <details key={line.id} className="editor-block-v2 editor-details" open={line.id === selectedField.guidanceLines[0]?.id}>
                <summary>{line.name}</summary>
                <label className="form-label">Guidance name</label>
                <input className="text-input compact-input" value={line.name} onChange={(e) => updateGuidanceName(selectedField.id, line.id, e.target.value)} />
                <div className="action-row compact-row compact-actions">
                  <button className="ghost-btn small-btn" onClick={() => addGuidancePoint(selectedField.id, line.id)}>Add point</button>
                  <button className="danger-btn small-btn" onClick={() => deleteGuidance(selectedField.id, line.id)}>Delete line</button>
                </div>
                {line.points.map((point) => (
                  <div key={point.id} className="coord-grid-v2">
                    <input className="text-input compact-input" value={point.latitude} onChange={(e) => updateGuidancePoint(selectedField.id, line.id, point.id, Number(e.target.value), point.longitude)} />
                    <input className="text-input compact-input" value={point.longitude} onChange={(e) => updateGuidancePoint(selectedField.id, line.id, point.id, point.latitude, Number(e.target.value))} />
                  </div>
                ))}
              </details>
            ))}

            {selectedField.boundaries.map((boundary) => (
              <details key={boundary.id} className="editor-block-v2 editor-details">
                <summary>Boundary</summary>
                <div className="action-row compact-row compact-actions">
                  <button className="ghost-btn small-btn" onClick={() => addBoundaryPoint(selectedField.id, boundary.id)}>Add boundary point</button>
                  <button className="danger-btn small-btn" onClick={() => deleteBoundary(selectedField.id, boundary.id)}>Delete boundary</button>
                </div>
                {boundary.points.map((point) => (
                  <div key={point.id} className="coord-grid-v3">
                    <input className="text-input compact-input" value={point.latitude} onChange={(e) => updateBoundaryPoint(selectedField.id, boundary.id, point.id, Number(e.target.value), point.longitude)} />
                    <input className="text-input compact-input" value={point.longitude} onChange={(e) => updateBoundaryPoint(selectedField.id, boundary.id, point.id, point.latitude, Number(e.target.value))} />
                    <button className="mini-delete" onClick={() => deleteBoundaryPoint(selectedField.id, boundary.id, point.id)}>×</button>
                  </div>
                ))}
              </details>
            ))}
          </>
        ) : (
          <div className="empty-panel small">Select a field to edit it.</div>
        )}
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
          editingEnabled={true}
          onSelectField={setSelectedFieldId}
          onAddDraftPoint={() => {}}
          onMoveBoundaryPoint={(boundaryId, pointId, lat, lon) => {
            if (!selectedFieldId) return
            updateBoundaryPoint(selectedFieldId, boundaryId, pointId, lat, lon)
          }}
          onMoveGuidancePoint={(guidanceId, pointId, lat, lon) => {
            if (!selectedFieldId) return
            updateGuidancePoint(selectedFieldId, guidanceId, pointId, lat, lon)
          }}
          dataVersion={dataVersion}
        />
      </section>
    </div>
  )
}
