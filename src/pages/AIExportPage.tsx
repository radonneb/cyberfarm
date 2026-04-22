import { useMemo, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { GEMINI_MODELS, generateExampleMatchedExport } from '../utils/geminiExport'

export default function AIExportPage() {
  const { loadedTaskData, selectedFieldId, setErrorMessage } = useAppStore()
  const allFields = loadedTaskData?.fields ?? []
  const selectedField = allFields.find((field) => field.id === selectedFieldId) ?? null
  const [exampleFile, setExampleFile] = useState<File | null>(null)
  const [apiKey, setApiKey] = useState(import.meta.env.VITE_GEMINI_API_KEY ?? '')
  const [model, setModel] = useState(GEMINI_MODELS[0] ?? 'gemini-2.5-flash')
  const [customModel, setCustomModel] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)

  const exportBaseName = useMemo(() => {
    const sourceName = selectedField?.name || loadedTaskData?.farm?.name || 'Field_Export'
    return sourceName.replace(/[^a-z0-9_\-]+/gi, '_')
  }, [loadedTaskData?.farm?.name, selectedField?.name])

  const runAiExport = async () => {
    if (!loadedTaskData) {
      setErrorMessage('No task data loaded.')
      return
    }
    if (!exampleFile) {
      setErrorMessage('Add an example file first.')
      return
    }

    try {
      setIsGenerating(true)
      await generateExampleMatchedExport({
        apiKey,
        model: customModel.trim() || model,
        exampleFile,
        task: loadedTaskData,
        baseName: exportBaseName,
      })
      setErrorMessage('AI package generated successfully.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'AI export failed')
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="content-grid single-page-grid">
      <section className="page-card compact-card ai-export-card">
        <div className="section-kicker compact-kicker">AI package export</div>
        <div className="hint-box compact-box">
          Upload an example package or file. The app will ask Gemini to create a new export package with a similar structure.
          This is a helper tool and may need review after generation.
        </div>

        <div className="two-col-form">
          <div>
            <label className="form-label">Example file</label>
            <input className="text-input compact-input file-input" type="file" accept=".zip,.kml,.xml,.ini" onChange={(event) => setExampleFile(event.target.files?.[0] ?? null)} />
            {exampleFile && <div className="helper-line">Loaded example: {exampleFile.name}</div>}
          </div>
          <div>
            <label className="form-label">Gemini API key</label>
            <input className="text-input compact-input" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Use VITE_GEMINI_API_KEY or paste a key here" />
          </div>
          <div>
            <label className="form-label">Official Gemini model</label>
            <select className="text-input compact-input" value={model} onChange={(event) => setModel(event.target.value)}>
              {GEMINI_MODELS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Custom model ID</label>
            <input className="text-input compact-input" value={customModel} onChange={(event) => setCustomModel(event.target.value)} placeholder="Optional: enter a custom model ID" />
          </div>
        </div>

        <div className="action-row compact-actions">
          <button className="primary-btn small-btn" onClick={runAiExport} disabled={isGenerating}>{isGenerating ? 'Generating…' : 'Generate AI Package'}</button>
        </div>
      </section>
    </div>
  )
}
