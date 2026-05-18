export type CanonicalMovementType =
  | 'GRN'
  | 'ISSUE'
  | 'RETURN_SUPPLIER'
  | 'RETURN_CUSTOMER'
  | 'ADJUSTMENT_PROFIT'
  | 'ADJUSTMENT_LOSS'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'PRODUCTION_INPUT'
  | 'PRODUCTION_OUTPUT';

export interface MovementLinePayload {
  item_code: number;
  quantity: number;
  unit_price?: number;
  notes?: string;
  pack_count?: number;
  pack_capacity?: number;
}

export interface WorkspaceMovementPayload {
  movement_date: string;
  warehouse_id: number;
  movement_type: CanonicalMovementType;
  supplier_code?: number;
  document_number?: number;
  payment_method?: 'cash' | 'credit';
  target_warehouse_id?: number;
  season_id?: number;
  field_id?: number;
  work_order_id?: number;
  notes?: string;
  center_code?: number;
  service_type_code?: string;
  statement_text?: string;
  items: MovementLinePayload[];
}

export interface WorkspaceDraftPayload {
  id: string;
  version: number;
  header: {
    movement_date: string;
    warehouse_id: number | null;
    target_warehouse_id: number | null;
    movement_type: CanonicalMovementType;
    supplier_code: number | null;
    document_number: string;
    notes: string;
    payment_method: 'cash' | 'credit';
  };
  dimensions: {
    season_id: number | null;
    field_id: number | null;
    work_order_id: number | null;
    center_code: number | null;
    service_type_code: string;
    statement_text: string;
  };
  lines: Array<{
    id: string;
    item_code: number | null;
    quantity: number | null;
    pack_count: number | null;
    unit_price: number | null;
    notes: string;
    package_capacity: number | null;
    available?: number;
  }>;
  meta?: any;
}

export interface MovementValidationShape {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}
