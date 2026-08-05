import L from 'leaflet'
import { Marker } from 'react-leaflet'
import { useAppStore } from '../store/appStore'

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character)
}

export default function FieldNameLabels({ pane }: { pane?: string }) {
  const { loadedTaskData } = useAppStore()
  if (!loadedTaskData?.tools?.mapView?.showFieldLabels) return null
  return <>
    {loadedTaskData.fields.map((field) => {
      const points = field.boundaries.flatMap((boundary) => boundary.points)
      if (!points.length) return null
      const bounds = L.latLngBounds(points.map((point) => [point.latitude, point.longitude]))
      return <Marker
        key={field.id}
        position={bounds.getCenter()}
        pane={pane ?? 'markerPane'}
        interactive={false}
        icon={L.divIcon({ className: 'field-name-marker', html: `<span>${escapeHtml(field.name)}</span>` })}
      />
    })}
  </>
}
