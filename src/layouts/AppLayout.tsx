import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useRef } from 'react'
import { useAppStore } from '../store/appStore'
import SidebarNav from '../components/SidebarNav'

const pageTitles: Record<string, string> = {
  '/': 'Home',
  '/create-field': 'Create Field',
  '/generate-lines': 'Generate Lines',
  '/edit-field': 'Edit Field',
  '/export': 'Export',
  '/ai-export': 'AI Export',
}

export default function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const {
    currentFileName,
    importHistory,
    openHistoryItem,
    deleteHistoryItem,
    importAny,
    createEmptyMap,
    saveCurrentTaskData,
    loadedTaskData,
    selectedFieldId,
    errorMessage,
    setErrorMessage,
  } = useAppStore()

  const allFields = loadedTaskData?.fields ?? []
  const selectedField = allFields.find((field) => field.id === selectedFieldId) ?? null
  const clientName = loadedTaskData?.client?.name ?? '—'
  const farmName = loadedTaskData?.farm?.name ?? '—'

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    await importAny(file)
    event.target.value = ''
    navigate('/')
  }

  const saveAll = () => {
    if (saveCurrentTaskData()) {
      setErrorMessage('Changes saved.')
      window.setTimeout(() => setErrorMessage(null), 1800)
    }
  }

  return (
    <div className="shell-v2">
      <header className="topbar-v3 page-card glass-bar">
        <div className="topbar-row topbar-row-main">
          <div className="topbar-heading-wrap">
            <div className="section-kicker compact-kicker">Page</div>
            <h1 className="page-heading">{pageTitles[location.pathname] ?? 'PFEthebest'}</h1>
          </div>

          <div className="topbar-tools">
            <details className="recent-dropdown glass-pill">
              <summary>Recent Files</summary>
              <div className="recent-dropdown-menu page-card">
                {importHistory.length ? importHistory.slice(0, 12).map((item) => (
                  <div key={item.id} className="history-item-v2 dropdown-history-item">
                    <button className="history-open-v2" onClick={() => openHistoryItem(item.id)}>{item.originalFileName}</button>
                    <button className="mini-delete" onClick={() => deleteHistoryItem(item.id)}>×</button>
                  </div>
                )) : <div className="empty-panel small">History is empty.</div>}
              </div>
            </details>

            <button className="primary-btn small-btn" onClick={() => fileInputRef.current?.click()}>Import</button>
            <button className="ghost-btn small-btn" onClick={createEmptyMap}>New Map</button>
            <button className="success-btn small-btn" onClick={saveAll}>Save</button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml,.isoxml,.kml,.kmz,.zip,.geojson,.json,.shp,.ini"
              hidden
              onChange={handleImport}
            />
          </div>
        </div>

        <div className="topbar-row topbar-row-bottom">
          <div className="topbar-meta compact-meta">
            <span>{allFields.length} fields</span>
            <span>Client: {clientName}</span>
            <span>Farm: {farmName}</span>
            <span>{selectedField ? `Selected: ${selectedField.name}` : 'No field selected'}</span>
            <span>{currentFileName ?? 'No file loaded'}</span>
          </div>
          <SidebarNav />
        </div>
      </header>

      {errorMessage && (
        <div className="page-card error-card toast-card">
          <span>{errorMessage}</span>
          <button className="ghost-btn small-btn" onClick={() => setErrorMessage(null)}>Close</button>
        </div>
      )}

      <main className="page-body-full">
        <Outlet />
      </main>
    </div>
  )
}
