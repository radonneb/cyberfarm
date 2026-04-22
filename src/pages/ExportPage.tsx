import { useAppStore } from '../store/appStore'
import { FieldInfoPanel } from '../appHelpers'

export default function ExportPage() {
  const { loadedTaskData, selectedFieldId, exportCurrent } = useAppStore()
  const allFields = loadedTaskData?.fields ?? []
  const selectedField = allFields.find((field) => field.id === selectedFieldId) ?? null

  return (
    <div className="content-grid export-grid-v2">
      <section className="page-card work-form-card compact-card left-panel-card">
        <div className="section-kicker compact-kicker">Export</div>
        <div className="hint-box compact-box">Export the current map state. Field package creates a ZIP like Field_Field01 with .ini + .kml inside.</div>
        <div className="export-actions-grid vertical-actions">
          <button className="ghost-btn small-btn" onClick={() => exportCurrent('fieldpackage')}>Export Field Package ZIP</button>
          <button className="ghost-btn small-btn" onClick={() => exportCurrent('shp')}>Export SHP ZIP</button>
          <button className="ghost-btn small-btn" onClick={() => exportCurrent('isoxml')}>Export ISOXML</button>
          <button className="ghost-btn small-btn" onClick={() => exportCurrent('kml')}>Export KML</button>
          <button className="ghost-btn small-btn" onClick={() => exportCurrent('kmz')}>Export KMZ</button>
        </div>
      </section>

      <section className="page-card compact-card right-panel-card scroll-panel export-info-card-v2">
        <FieldInfoPanel field={selectedField} />
      </section>
    </div>
  )
}
