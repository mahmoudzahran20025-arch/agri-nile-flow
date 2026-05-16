import type { WorkspaceMovementPayload } from './movementSchema';

export class PayloadNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadNormalizationError';
  }
}

export function normalizeMovementPayload(raw: any): WorkspaceMovementPayload {
  if (!raw) {
    throw new PayloadNormalizationError('Payload cannot be empty');
  }

  // 1. Enforce warehouse_id
  const warehouse_id = raw.warehouse_id ?? raw.warehouse;
  if (warehouse_id === undefined || warehouse_id === null || warehouse_id === '') {
    throw new PayloadNormalizationError('warehouse_id is required');
  }
  if (typeof warehouse_id === 'string' && isNaN(Number(warehouse_id))) {
    throw new PayloadNormalizationError(`Invalid warehouse_id: string names are no longer permitted ('${warehouse_id}')`);
  }

  // 2. Enforce movement_type
  const movement_type = raw.movement_type;
  if (!movement_type) {
    throw new PayloadNormalizationError('movement_type is required');
  }

  // 3. Optional target_warehouse_id validation
  const target_warehouse_id = raw.target_warehouse_id ?? raw.to_warehouse;
  if (target_warehouse_id !== undefined && target_warehouse_id !== null && target_warehouse_id !== '') {
    if (typeof target_warehouse_id === 'string' && isNaN(Number(target_warehouse_id))) {
      throw new PayloadNormalizationError(`Invalid target_warehouse_id: string names are no longer permitted ('${target_warehouse_id}')`);
    }
  }

  // 4. Validate items
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    throw new PayloadNormalizationError('Movement payload must contain at least one item');
  }

  const items = raw.items.map((item: any, index: number) => {
    if (!item.item_code) {
      throw new PayloadNormalizationError(`Item at index ${index} is missing item_code`);
    }
    const quantity = Number(item.quantity);
    if (isNaN(quantity) || quantity <= 0) {
      throw new PayloadNormalizationError(`Item at index ${index} has invalid quantity: ${item.quantity}`);
    }
    return {
      item_code: Number(item.item_code),
      quantity: quantity,
      unit_price: item.unit_price ? Number(item.unit_price) : undefined,
      notes: item.notes || undefined,
      pack_count: item.pack_count ? Number(item.pack_count) : undefined,
      pack_capacity: item.pack_capacity ? Number(item.pack_capacity) : undefined,
    };
  });

  // 5. Construct canonical payload
  return {
    movement_date: raw.movement_date || new Date().toISOString().split('T')[0],
    warehouse_id: Number(warehouse_id),
    movement_type: movement_type as any, // Cast to CanonicalMovementType after check
    target_warehouse_id: target_warehouse_id ? Number(target_warehouse_id) : undefined,
    supplier_code: raw.supplier_code ? Number(raw.supplier_code) : undefined,
    document_number: raw.document_number ? Number(raw.document_number) : undefined,
    payment_method: raw.payment_method === 'cash' ? 'cash' : 'credit',
    season_id: raw.season_id ? Number(raw.season_id) : undefined,
    field_id: raw.field_id ? Number(raw.field_id) : undefined,
    work_order_id: raw.work_order_id ? Number(raw.work_order_id) : undefined,
    center_code: raw.center_code ? Number(raw.center_code) : undefined,
    service_type_code: raw.service_type_code || undefined,
    statement_text: raw.statement_text || undefined,
    notes: raw.notes || undefined,
    items,
  };
}
