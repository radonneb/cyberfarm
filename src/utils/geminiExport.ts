import JSZip from 'jszip'
import type { TaskDataModel } from '../models/taskData'

export const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-preview',
  'gemini-3.1-pro-preview',
] as const

async function exampleToManifest(file: File) {
  if (file.name.toLowerCase().endsWith('.zip')) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer())
    const entries = Object.values(zip.files).filter((entry) => !entry.dir)
    return Promise.all(entries.map(async (entry) => ({
      name: entry.name.split('/').pop() || entry.name,
      content: await entry.async('string'),
    })))
  }

  return [{ name: file.name, content: await file.text() }]
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function stripFence(text: string) {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
}

export async function generateExampleMatchedExport(input: {
  apiKey: string
  model: string
  exampleFile: File
  task: TaskDataModel
  baseName: string
}) {
  const apiKey = input.apiKey.trim()
  if (!apiKey) throw new Error('Add a Gemini API key first.')

  const exampleFiles = await exampleToManifest(input.exampleFile)
  const prompt = `You generate agricultural field files that must match a provided example package as closely as possible.

Return strict JSON only:
{
  "files": [
    { "name": "string", "content": "string" }
  ]
}

Rules:
- Match the example package structure, naming style, and extensions.
- Preserve the field geometry and guidance lines from the task data.
- If the example uses INI + KML, output INI + KML.
- No markdown fences. No commentary. Valid JSON only.

Example package:
${JSON.stringify(exampleFiles, null, 2)}

Task data:
${JSON.stringify(input.task, null, 2)}
`

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      generationConfig: { responseMimeType: 'application/json' },
      contents: [{ parts: [{ text: prompt }] }],
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Gemini request failed: ${response.status} ${detail}`)
  }

  const data = await response.json()
  const responseText = data?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('')
  if (!responseText) throw new Error('Gemini returned an empty response.')

  const parsed = JSON.parse(stripFence(responseText)) as { files?: Array<{ name?: string; content?: string }> }
  const files = (parsed.files ?? []).filter((item) => item?.name && typeof item?.content === 'string') as Array<{ name: string; content: string }>
  if (!files.length) throw new Error('Gemini did not return any files.')

  const zip = new JSZip()
  for (const file of files) zip.file(file.name, file.content)
  const blob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(blob, `${input.baseName || 'field_export'}_ai_package.zip`)
}
