import { useMemo, useState } from 'react'
import MapView from '../components/MapView'
import { useAppStore } from '../store/appStore'
import { FieldInfoPanel, useMapLayers } from '../appHelpers'

export default function HomePage() {
  const {
    loadedTaskData,
    selectedFieldId,
    setSelectedFieldId,
    editorMode,
    draftCreate,
    addDraftBoundaryPoint,
    addDraftGuidancePoint,
    dataVersion,
  } = useAppStore()
  const [searchQuery, setSearchQuery] = useState('')
  const allFields = loadedTaskData?.fields ?? []
  const selectedField = allFields.find((field) => field.id === selectedFieldId) ?? null
  const { polygonLayer, guidanceLayer } = useMapLayers()

  const filteredFields = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return allFields
    return allFields.filter((field) => field.name.toLowerCase().includes(query))
  }, [allFields, searchQuery])

  return (
    <div className="content-grid home-grid-v2">
      <section className="page-card compact-card left-panel-card">
        <div className="section-kicker compact-kicker">Field list</div>
        <input
          className="text-input compact-input"
          placeholder="Search field"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div className="field-list-v2 scroll-area">
          {filteredFields.length ? filteredFields.map((field) => (
            <button
              key={field.id}
              className={`field-item-v2 ${field.id === selectedFieldId ? 'active' : ''}`}
              onClick={() => setSelectedFieldId(field.id)}
            >
              <strong>{field.name}</strong>
              <span>{field.guidanceLines.length} lines</span>
            </button>
          )) : <div className="empty-panel small">No fields found.</div>}
        </div>
      </section>

      <section className="page-card map-card main-map-card compact-card">
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

      <section className="page-card compact-card right-panel-card">
        <FieldInfoPanel field={selectedField} />
      </section>
    </div>
  )
}
