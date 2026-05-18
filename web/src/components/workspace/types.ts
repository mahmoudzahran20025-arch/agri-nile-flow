// ─── Movement Workspace Types ────────────────────────────────────────────────
// Shared across all workspace components. No runtime code — types only.

export type MovementType =
  | 'GRN'
  | 'ISSUE'
  | 'RETURN_SUPPLIER'
  | 'RETURN_CUSTOMER'
  | 'ADJUSTMENT_PROFIT'
  | 'ADJUSTMENT_LOSS'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'

export type DraftStatus =
  | 'draft'
  | 'dirty'
  | 'saving'
  | 'saved'
  | 'posting'
  | 'posted'
  | 'recovery'
  | 'conflict'
  | 'failed'

export interface DraftLifecycleState {
  status: DraftStatus;
  lastSavedAt: string | null;
  draftId: string;
  version: number;
}

export type WorkspaceMode =
  | 'create'
  | 'draft-edit'
  | 'readonly'
  | 'recovery'

export type NetworkState =
  | 'online'
  | 'offline'
  | 'reconnecting'

export interface MovementHeader {
  movement_type:       MovementType
  movement_date:       string
  warehouse_id:        number | null
  target_warehouse_id: number | null
  supplier_code:       number | null
  document_number:     string
  notes:               string
  payment_method:      'cash' | 'credit'
}

export interface MovementDimensions {
  season_id:         number | null
  center_code:       number | null
  field_id:          number | null
  work_order_id:     number | null
  crop_cycle_id:     number | null
  service_type_code: string
  statement_text:    string
}

export interface LineItem {
  _key:             string
  item_code:        number | null
  item_name:        string
  item_unit:        string
  // Packaging — populated from item master on item selection
  package_type:     string | null
  package_capacity: number | null
  pack_count:       number | null
  // quantity is the canonical base-unit value posted to the GL.
  // When _qty_derived=true it is auto-computed from pack_count × package_capacity
  // and the field is locked read-only in the UI.
  quantity:         number | null
  _qty_derived:     boolean
  // Unit conversion: user may enter qty in a different unit (e.g. bags → KG).
  // transaction_unit is sent to the backend which normalizes to base_unit.
  // When null/empty, backend treats quantity as already in base_unit.
  transaction_unit: string | null
  // total_value is the primary user-facing entry when packaging mode is active.
  // unit_price is computed from total_value / quantity before submission.
  total_value:      number | null
  unit_price:       number | null
  notes:            string
  // Runtime enrichment (not persisted)
  _available:       number | null
  _stockLoading:    boolean
  _error:           string | null
  _warning:         string | null
}

export interface MovementMeta {
  source:                   'manual' | 'recovered' | 'prefilled'
  recovery_state:           'clean' | 'recovered' | 'conflict'
  last_persist_duration_ms: number
  last_recovered_at?:       string
  autosave_enabled:         boolean
}

export interface MovementDraft {
  id:         string
  created_at: string
  updated_at: string
  version:    number
  header:     MovementHeader
  dimensions: MovementDimensions
  lines:      LineItem[]
  meta:       MovementMeta
}

export interface ValidationIssue {
  line_index: number | null
  field:      string
  message:    string
  severity:   'error' | 'warning'
}

export interface ValidationResult {
  valid:         boolean
  errors:        ValidationIssue[]
  warnings:      ValidationIssue[]
  readiness_pct: number
}

// ─── Movement type metadata ──────────────────────────────────────────────────

export interface MovementTypeMeta {
  value:  MovementType
  label:  string
  sub:    string
  icon:   string
  isIn:   boolean
}

export const MOVEMENT_TYPES: MovementTypeMeta[] = [
  { value: 'GRN',               label: 'استلام بضاعة',  sub: 'وارد من مورد',   icon: '↓', isIn: true  },
  { value: 'RETURN_CUSTOMER',   label: 'مرتجع عميل',   sub: 'مردود للمخزن',  icon: '↩', isIn: true  },
  { value: 'ADJUSTMENT_PROFIT', label: 'تسوية زيادة',  sub: 'فائض جردي',     icon: '+', isIn: true  },
  { value: 'ISSUE',             label: 'صرف مخزون',     sub: 'خروج من المخزن', icon: '↑', isIn: false },
  { value: 'RETURN_SUPPLIER',   label: 'مرتجع مورد',   sub: 'إرجاع للمورد',  icon: '↪', isIn: false },
  { value: 'ADJUSTMENT_LOSS',   label: 'تسوية نقص',     sub: 'عجز جردي',      icon: '−', isIn: false },
  { value: 'TRANSFER_OUT',      label: 'تحويل منصرف',  sub: 'صرف لمخزن آخر',  icon: '↗', isIn: false },
  { value: 'TRANSFER_IN',       label: 'تحويل وارد',    sub: 'وارد من مخزن آخر',icon: '↘', isIn: true  },
]

export function isInboundType(t: MovementType): boolean {
  return ['GRN', 'RETURN_CUSTOMER', 'ADJUSTMENT_PROFIT', 'TRANSFER_IN'].includes(t)
}

export function isSupplierType(t: MovementType): boolean {
  return t === 'GRN' || t === 'RETURN_SUPPLIER'
}

export function isTransferType(t: MovementType): boolean {
  return t === 'TRANSFER_IN' || t === 'TRANSFER_OUT'
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function createEmptyLine(): LineItem {
  return {
    _key:             crypto.randomUUID(),
    item_code:        null,
    item_name:        '',
    item_unit:        '',
    package_type:     null,
    package_capacity: null,
    pack_count:       null,
    quantity:         null,
    _qty_derived:     false,
    transaction_unit: null,
    total_value:      null,
    unit_price:       null,
    notes:            '',
    _available:       null,
    _stockLoading:    false,
    _error:           null,
    _warning:         null,
  }
}

export function createDefaultHeader(): MovementHeader {
  return {
    movement_type:       'GRN',
    movement_date:       new Date().toISOString().slice(0, 10),
    warehouse_id:        null,
    target_warehouse_id: null,
    supplier_code:       null,
    document_number:     '',
    notes:               '',
    payment_method:      'credit',
  }
}

export function createDefaultDimensions(): MovementDimensions {
  return {
    season_id:         null,
    center_code:       null,
    field_id:          null,
    work_order_id:     null,
    crop_cycle_id:     null,
    service_type_code: '',
    statement_text:    '',
  }
}

export function createDefaultMeta(): MovementMeta {
  return {
    source:                   'manual',
    recovery_state:           'clean',
    last_persist_duration_ms: 0,
    autosave_enabled:         true,
  }
}

export function createEmptyDraft(): MovementDraft {
  const now = new Date().toISOString()
  return {
    id:         crypto.randomUUID(),
    created_at: now,
    updated_at: now,
    version:    1,
    header:     createDefaultHeader(),
    dimensions: createDefaultDimensions(),
    lines:      [createEmptyLine()],
    meta:       createDefaultMeta(),
  }
}

/** Strip runtime fields before serialization */
export function serializeDraft(draft: MovementDraft): string {
  const cleaned: MovementDraft = {
    ...draft,
    lines: draft.lines.map(l => ({
      ...l,
      _available:    null,
      _stockLoading: false,
      _error:        null,
      _warning:      null,
      // _qty_derived is recomputed on load from pack_count × package_capacity
      _qty_derived:  false,
    })),
  }
  return JSON.stringify(cleaned)
}
