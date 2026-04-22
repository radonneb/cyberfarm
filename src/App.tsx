import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './layouts/AppLayout'
import HomePage from './pages/HomePage'
import CreateFieldPage from './pages/CreateFieldPage'
import GenerateLinesPage from './pages/GenerateLinesPage'
import EditFieldPage from './pages/EditFieldPage'
import ExportPage from './pages/ExportPage'
import AIExportPage from './pages/AIExportPage'
import './App.css'

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/create-field" element={<CreateFieldPage />} />
        <Route path="/generate-lines" element={<GenerateLinesPage />} />
        <Route path="/edit-field" element={<EditFieldPage />} />
        <Route path="/export" element={<ExportPage />} />
        <Route path="/ai-export" element={<AIExportPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default App
