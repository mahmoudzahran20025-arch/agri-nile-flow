// ─────────────────────────────────────────────────────────────
// GeoJSON Geo-utilities (no external dependencies)
// Used for: area calculation + centroid from drawn field polygons
// ─────────────────────────────────────────────────────────────

const FEDDAN_M2 = 4200.833   // 1 feddan = 4200.833 m²
const R_EARTH   = 6_371_000  // Earth radius in meters

// ── Type helpers ────────────────────────────────────────────
export type LngLat = [number, number]   // GeoJSON standard: [lng, lat]

export interface GeoFieldResult {
  area_feddan:  number
  center_lat:   number
  center_lng:   number
  boundary_geojson: string    // cleaned FeatureCollection string
  coords:       LngLat[]      // first ring coordinates
}

// ─────────────────────────────────────────────────────────────
// Parse GeoJSON pasted by user (from geojson.io)
// Supports: FeatureCollection, Feature, Polygon, MultiPolygon
// ─────────────────────────────────────────────────────────────
export function parseGeoJSON(raw: string): GeoFieldResult {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw.trim())
  } catch {
    throw new Error('النص ليس JSON صحيحاً — تأكد من النسخ من geojson.io')
  }

  const coords = extractFirstRing(parsed)
  if (coords.length < 4) {
    throw new Error('الحدود المرسومة غير صحيحة — يجب أن تكون مضلعاً مغلقاً (polygon)')
  }

  const area_feddan = ringAreaFeddan(coords)
  const [center_lng, center_lat] = ringCentroid(coords)

  // Normalize to a clean FeatureCollection
  const cleanGeoJSON: Record<string, unknown> = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [coords] },
    }],
  }

  return {
    area_feddan: Math.round(area_feddan * 1000) / 1000,
    center_lat:  Math.round(center_lat  * 1_000_000) / 1_000_000,
    center_lng:  Math.round(center_lng  * 1_000_000) / 1_000_000,
    boundary_geojson: JSON.stringify(cleanGeoJSON),
    coords,
  }
}

// ─────────────────────────────────────────────────────────────
// Extract first polygon ring from any GeoJSON structure
// ─────────────────────────────────────────────────────────────
function extractFirstRing(geojson: Record<string, unknown>): LngLat[] {
  const type = geojson.type as string

  if (type === 'FeatureCollection') {
    const features = geojson.features as Record<string, unknown>[]
    if (!features?.length) throw new Error('GeoJSON فارغ — ارسم القطعة أولاً')
    return extractFirstRing(features[0])
  }

  if (type === 'Feature') {
    return extractFirstRing(geojson.geometry as Record<string, unknown>)
  }

  if (type === 'Polygon') {
    const coords = geojson.coordinates as LngLat[][]
    return coords[0]
  }

  if (type === 'MultiPolygon') {
    const coords = geojson.coordinates as LngLat[][][]
    return coords[0][0]
  }

  throw new Error(`نوع GeoJSON غير مدعوم: ${type} — ارسم Polygon فقط`)
}

// ─────────────────────────────────────────────────────────────
// Area calculation using Spherical Excess formula
// Accurate for small areas (agricultural fields)
// Returns: area in FEDDAN
// ─────────────────────────────────────────────────────────────
function ringAreaFeddan(ring: LngLat[]): number {
  let area = 0
  const n = ring.length

  for (let i = 0; i < n - 1; i++) {
    const [lng1, lat1] = ring[i]
    const [lng2, lat2] = ring[i + 1]
    const dLng = (lng2 - lng1) * Math.PI / 180
    area += dLng * (2 + Math.sin(lat1 * Math.PI / 180) + Math.sin(lat2 * Math.PI / 180))
  }

  const areaM2 = Math.abs(area * R_EARTH * R_EARTH / 2)
  return areaM2 / FEDDAN_M2
}

// ─────────────────────────────────────────────────────────────
// Centroid: weighted by segment length (more accurate than simple average)
// ─────────────────────────────────────────────────────────────
function ringCentroid(ring: LngLat[]): LngLat {
  const n = ring.length
  let lngSum = 0, latSum = 0, weightSum = 0

  for (let i = 0; i < n - 1; i++) {
    const [lng1, lat1] = ring[i]
    const [lng2, lat2] = ring[i + 1]
    const w = Math.sqrt((lng2 - lng1) ** 2 + (lat2 - lat1) ** 2)
    lngSum    += (lng1 + lng2) / 2 * w
    latSum    += (lat1 + lat2) / 2 * w
    weightSum += w
  }

  return weightSum > 0
    ? [lngSum / weightSum, latSum / weightSum]
    : [ring[0][0], ring[0][1]]
}

// ─────────────────────────────────────────────────────────────
// Point-in-Polygon (Ray casting)
// For checking if employee GPS is inside field boundary
// ─────────────────────────────────────────────────────────────
export function pointInPolygon(lat: number, lng: number, ring: LngLat[]): boolean {
  let inside = false
  const n = ring.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersect = ((yi > lat) !== (yj > lat))
      && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

// ─────────────────────────────────────────────────────────────
// Build geojson.io URL centered on employee current GPS
// ─────────────────────────────────────────────────────────────
export function buildGeoJSONioURL(lat: number, lng: number, zoom = 17): string {
  return `https://geojson.io/#map=${zoom}/${lat}/${lng}`
}

// ─────────────────────────────────────────────────────────────
// Format area display
// ─────────────────────────────────────────────────────────────
export function formatFeddan(feddan: number): string {
  if (feddan >= 1) return `${feddan.toFixed(2)} فدان`
  const qirat = feddan * 24
  if (qirat >= 1) return `${qirat.toFixed(1)} قيراط`
  return `${(qirat * 24).toFixed(0)} سهم`
}
