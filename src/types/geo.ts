import type {
  Feature,
  FeatureCollection,
  Geometry,
  LineString,
  Polygon,
} from 'geojson'

export type AppFeatureProperties = {
  __fieldId?: string
  __fieldName?: string
  __guidanceId?: string
  __guidanceName?: string
  __parentFieldId?: string
  __parentFieldName?: string
  [key: string]: unknown
}

export type GuidanceProperties = {
  __guidanceId: string
  __guidanceName: string
  __parentFieldId?: string
  __parentFieldName?: string
  [key: string]: unknown
}

export type AppFeature = Feature<Geometry, AppFeatureProperties>
export type AppPolygonFeature = Feature<Polygon, AppFeatureProperties>
export type AppLineFeature = Feature<LineString, GuidanceProperties>

export type AppFeatureCollection = FeatureCollection<Geometry, AppFeatureProperties>
export type AppPolygonCollection = FeatureCollection<Polygon, AppFeatureProperties>
export type AppGuidanceCollection = FeatureCollection<LineString, GuidanceProperties>

export type ImportedFieldItem = {
  id: string
  name: string
}

export type ImportParseResult = {
  collection: AppPolygonCollection
  guidanceCollection: AppGuidanceCollection | null
  sourceName: string
  sourceType: string
}
