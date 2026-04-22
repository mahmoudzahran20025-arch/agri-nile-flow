# 🏗️ System Architecture & Data Flow Design
**Date:** April 20, 2026  
**Level:** Enterprise Architecture  
**Audience:** Technical Team

---

## 📊 Part 1: Current Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CURRENT SYSTEM                           │
│                                                             │
│  Frontend Layer (React + Zustand)                           │
│  ├─ Login Page                                              │
│  ├─ Dashboard                                               │
│  └─ Data Pages (suppliers, treasury, inventory)             │
│       ↓ (API Calls)                                          │
│                                                             │
│  API Layer (Hono on Cloudflare Workers)                    │
│  ├─ /api/suppliers → list, detail, create, update          │
│  ├─ /api/treasury → list, create                           │
│  ├─ /api/inventory → balances, movements                   │
│  └─ /api/auth → login, token validation                    │
│       ↓ (SQL Queries)                                       │
│                                                             │
│  Database Layer (D1 SQLite)                                 │
│  ├─ items (master data)                                     │
│  ├─ warehouses (master data)                                │
│  ├─ suppliers (master data)                                 │
│  ├─ inventory_movements (transactional)                     │
│  └─ 31 other tables...                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘

Issues:
❌ No validation layer between API & DB
❌ No staging for problematic data
❌ No audit trail
❌ No cache layer
❌ Limited error handling
```

---

## ✅ Part 2: Recommended Architecture

### **Layered Architecture (Best Practice)**

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  ┌─ UI/Presentation Layer ─────────────────────────────────┐ │
│  │                                                          │ │
│  │  Frontend (React + TypeScript)                          │ │
│  │  ├─ Components (Form, Table, Modal, etc.)              │ │
│  │  ├─ Stores (Zustand)                                   │ │
│  │  ├─ Hooks (useQuery from React Query)                  │ │
│  │  └─ Validations (Client-side, real-time)              │ │
│  │                                                          │ │
│  └──────────────────────────────────────────────────────────┘ │
│          ↓ (HTTPS, Authenticated)                            │
│                                                              │
│  ┌─ API Layer ──────────────────────────────────────────────┐ │
│  │                                                          │ │
│  │  Hono Router + Middleware                              │ │
│  │  ├─ Auth Middleware                                    │ │
│  │  ├─ Validation Middleware                              │ │
│  │  ├─ Error Handling Middleware                          │ │
│  │  ├─ Logging Middleware                                 │ │
│  │  ├─ Rate Limiting Middleware                           │ │
│  │  └─ Endpoints                                          │ │
│  │     ├─ POST /api/inventory/movements                   │ │
│  │     ├─ GET /api/inventory/balances                     │ │
│  │     ├─ POST /api/inventory/validate                    │ │
│  │     └─ ... 23 more endpoints                           │ │
│  │                                                          │ │
│  └──────────────────────────────────────────────────────────┘ │
│          ↓ (Business Logic)                                  │
│                                                              │
│  ┌─ Application/Service Layer ─────────────────────────────┐ │
│  │                                                          │ │
│  │  Domain Services (Business Logic)                       │ │
│  │  ├─ InventoryService                                   │ │
│  │  │  ├─ createMovement()                                │ │
│  │  │  ├─ calculateWAC()                                  │ │
│  │  │  ├─ checkConflicts()                                │ │
│  │  │  └─ calculateProjectedBalance()                    │ │
│  │  ├─ ValidationService                                  │ │
│  │  │  ├─ validateMovement()                              │ │
│  │  │  ├─ validateCostVariance()                          │ │
│  │  │  └─ checkDuplicates()                               │ │
│  │  └─ AuditService                                        │ │
│  │     ├─ logChange()                                      │ │
│  │     ├─ getAuditTrail()                                 │ │
│  │     └─ getChangedFields()                              │ │
│  │                                                          │ │
│  └──────────────────────────────────────────────────────────┘ │
│          ↓ (Data Access)                                     │
│                                                              │
│  ┌─ Data Access Layer (DAL) ──────────────────────────────┐ │
│  │                                                          │ │
│  │  Repository Pattern                                    │ │
│  │  ├─ InventoryRepository                                │ │
│  │  │  ├─ create()                                        │ │
│  │  │  ├─ findById()                                      │ │
│  │  │  ├─ list()                                          │ │
│  │  │  ├─ update()                                        │ │
│  │  │  └─ delete()                                        │ │
│  │  ├─ AuditRepository                                     │ │
│  │  ├─ ValidationRepository                               │ │
│  │  └─ CacheRepository                                     │ │
│  │                                                          │ │
│  │  ┌─ Cache Layer (In-Memory + D1)                       │ │
│  │  │  ├─ React Query (frontend)                          │ │
│  │  │  ├─ Workers KV (edge cache)                         │ │
│  │  │  └─ Database indexes (read optimization)            │ │
│  │  │                                                      │ │
│  └──────────────────────────────────────────────────────────┘ │
│          ↓ (SQL)                                             │
│                                                              │
│  ┌─ Database Layer (D1 SQLite) ──────────────────────────┐ │
│  │                                                          │ │
│  │  Core Tables:                                          │ │
│  │  ├─ items (master)                                     │ │
│  │  ├─ warehouses (master)                                │ │
│  │  ├─ suppliers (master)                                 │ │
│  │  │                                                      │ │
│  │  Transactional Tables:                                 │ │
│  │  ├─ inventory_movements (fact)                         │ │
│  │  ├─ inventory_staging (quality control)                │ │
│  │  │                                                      │ │
│  │  Performance Tables:                                   │ │
│  │  ├─ stock_ledger (materialized view)                   │ │
│  │  ├─ running_balances (cached)                          │ │
│  │  │                                                      │ │
│  │  Audit Tables:                                         │ │
│  │  ├─ audit_log (all changes)                            │ │
│  │  └─ unit_conversions (reference)                       │ │
│  │                                                          │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 🔄 Part 3: Data Flow Scenarios

### **Scenario 1: Normal Inventory Movement (Happy Path)**

```
STEP 1: User opens form
┌──────────────────────────────┐
│ Frontend (React)             │
│ ├─ Load warehouses (cached)  │
│ ├─ Load items (cached)       │
│ └─ Load user defaults        │
└──────────────────────────────┘
         ↓
GET /api/warehouses (if cache miss)
  → API → Cache → DB → UI (5 seconds first load, <100ms cached)

STEP 2: User fills form
┌──────────────────────────────┐
│ Frontend Real-time Validation│
│ ├─ Item exists? (lookup)     │
│ ├─ Unit valid? (lookup)      │
│ ├─ Quantity positive?        │
│ ├─ Cost valid?               │
│ └─ Calculate totals (client) │
└──────────────────────────────┘
         ↓
GET /api/validate/item (async validator)
  → API → DB → Response (in <200ms)

STEP 3: User submits
┌──────────────────────────────┐
│ Frontend (submit)            │
│ └─ POST /api/inventory/       │
│    movements                  │
└──────────────────────────────┘
         ↓
POST /api/inventory/movements
  {
    documentType: "GRN",
    warehouseId: "wh-001",
    items: [...]
  }
         ↓
┌──────────────────────────────┐
│ API Validation               │
│ ├─ Auth check                │
│ ├─ Input schema validation   │
│ ├─ Business rule validation  │
│ └─ Conflict detection        │
└──────────────────────────────┘
         ↓
┌──────────────────────────────┐
│ Service Layer (Business      │
│ Logic)                       │
│ ├─ Calculate WAC             │
│ ├─ Project balances          │
│ ├─ Detect low stock          │
│ └─ Generate warnings         │
└──────────────────────────────┘
         ↓
┌──────────────────────────────┐
│ Database Transaction         │
│ ├─ Insert movement           │
│ ├─ Update stock_ledger       │
│ ├─ Insert audit_log          │
│ └─ Invalidate cache          │
└──────────────────────────────┘
         ↓
200 OK + { movementId, stockImpact, warnings }

STEP 4: Frontend updates
┌──────────────────────────────┐
│ Frontend (success)           │
│ ├─ Invalidate React Query    │
│ ├─ Show confirmation         │
│ ├─ Display warnings          │
│ └─ Redirect to next action   │
└──────────────────────────────┘
```

### **Scenario 2: Error Handling (Error Path)**

```
User enters: 10 PACK → System auto-calculates: 100 TABLET
BUT: Unit conversion for this item changed last week!

Old factor: 10 tablets/pack
New factor: 12 tablets/pack (supplier changed!)

FLOW:
User Input: 10 PACK
  ↓
Real-time Validation: "Unit not found for this item"
  ↓
API checks unit_conversions table (should find PACK=12x)
  ↓
Should return: 10 × 12 = 120 TABLET
  BUT: Record is old, not effective yet
  ↓
Warning: "⚠️ Unit conversion changed recently. Use 120 instead of 100?"

If user submits anyway:
  ↓
API calls ValidationService.validateMovement()
  ├─ Checks effective_from date
  ├─ Finds mismatch
  └─ Returns ERROR_INVALID_UNIT_CONVERSION
  ↓
Frontend receives error:
  "Unit conversion has been updated. Please recalculate."
  ↓
User clicks "Auto-fix" → Quantity updated to 120 TABLET
  ↓
Resubmit → SUCCESS
```

---

## 🗄️ Part 4: Proposed Database Schema (Additions)

### **Current Tables (35)**
```
items, warehouses, suppliers, treasury_transactions, ...
```

### **New Tables to Add (5)**

```sql
-- 1. Data Staging (Quality Control)
CREATE TABLE inventory_staging (
  id TEXT PRIMARY KEY,
  batch_id TEXT,                    -- Link to import batch
  source_file TEXT,
  source_row_number INTEGER,
  raw_data JSON,
  parsed_data JSON,
  
  validation_status ENUM('VALID', 'INVALID', 'WARNING'),
  validation_errors TEXT[],         -- Array of error messages
  
  status ENUM('PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED'),
  reviewed_by_user_id TEXT,
  reviewed_at TIMESTAMP,
  
  created_at TIMESTAMP,
  created_by_user_id TEXT,
  
  INDEX idx_batch_status (batch_id, status),
  INDEX idx_validation_status (validation_status)
);

-- 2. Audit Trail (Compliance)
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  
  -- What changed
  table_name TEXT,
  record_id TEXT,
  action ENUM('INSERT', 'UPDATE', 'DELETE'),
  
  -- Data changes
  old_values JSON,
  new_values JSON,
  changed_fields TEXT[],
  
  -- Who & when & why
  changed_by_user_id TEXT,
  changed_at TIMESTAMP,
  change_reason TEXT,
  
  -- Context
  api_endpoint TEXT,
  ip_address TEXT,
  user_agent TEXT,
  
  -- Immutable after creation
  INDEX idx_table_record (table_name, record_id, changed_at DESC),
  INDEX idx_user_time (changed_by_user_id, changed_at DESC),
  PRIMARY KEY (id)
);

-- 3. Unit Conversions (Reference Data)
CREATE TABLE unit_conversions (
  id TEXT PRIMARY KEY,
  
  from_unit TEXT,
  to_unit TEXT,
  conversion_factor DECIMAL(10,4),
  
  item_category TEXT,               -- null = applies to all
  item_id TEXT,                      -- null = applies to category
  
  effective_from DATE,
  effective_to DATE,
  
  notes TEXT,
  created_by_user_id TEXT,
  created_at TIMESTAMP,
  
  UNIQUE (from_unit, to_unit, item_category, effective_from),
  INDEX idx_from_to (from_unit, to_unit, effective_from),
  INDEX idx_effective_date (effective_from, effective_to)
);

-- 4. Validation Rules (Configurable Business Rules)
CREATE TABLE validation_rules (
  id TEXT PRIMARY KEY,
  
  rule_name TEXT,
  rule_category TEXT,               -- 'COST', 'QUANTITY', 'STOCK', etc.
  
  condition_sql TEXT,               -- SQL that detects violation
  severity ENUM('INFO', 'WARNING', 'ERROR'),
  
  message_en TEXT,
  message_ar TEXT,
  
  auto_fix_available BOOLEAN,
  auto_fix_function TEXT,
  
  requires_approval BOOLEAN,
  approval_threshold DECIMAL,       -- e.g., 100000 (EGP)
  
  enabled BOOLEAN,
  created_by_user_id TEXT,
  created_at TIMESTAMP,
  
  INDEX idx_category_enabled (rule_category, enabled)
);

-- 5. Cached Balances (Performance)
CREATE TABLE stock_ledger_cache (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT,
  item_id TEXT,
  
  -- Current state
  on_hand_qty DECIMAL(12,3),
  on_hand_value_fils INTEGER,
  average_cost_fils INTEGER,        -- WAC
  
  -- Movement stats
  last_movement_date DATE,
  last_movement_type TEXT,
  movements_this_month INTEGER,
  avg_movement_qty DECIMAL(12,3),
  
  -- Health indicators
  days_to_stockout INTEGER,
  turnover_ratio DECIMAL(5,2),
  
  -- Cache metadata
  calculated_at TIMESTAMP,
  valid_until TIMESTAMP,
  
  PRIMARY KEY (warehouse_id, item_id),
  INDEX idx_below_minimum (on_hand_qty < 100),  -- Low stock
  INDEX idx_cache_valid (valid_until > NOW())
);
```

---

## 🔐 Part 5: Data Validation Framework

### **Validation Pipeline**

```typescript
// 1. CLIENT-SIDE (Frontend - React)
// Purpose: Immediate feedback, prevent bad submissions
// Cost: Free (no API calls)
// Timing: Real-time as user types

const clientValidations = {
  itemCode: {
    required: true,
    minLength: 3,
    maxLength: 20,
    pattern: /^[A-Z0-9-]+$/,
    customValidator: (value) => {
      return itemsCache.has(value) ? null : 'Item not found (local cache)';
    }
  },
  quantity: {
    required: true,
    min: 0.01,
    max: 999999,
    pattern: /^\d+(\.\d{1,3})?$/
  },
  unitCost: {
    required: true,
    min: 0,
    pattern: /^\d+(\.\d{1,2})?$/
  }
};

// 2. API INPUT VALIDATION (Hono Middleware)
// Purpose: Ensure API contract is met
// Cost: <10ms per request
// Timing: Before business logic

const apiValidation = z.object({
  documentType: z.enum(['GRN', 'STOCK_RETURN', 'ADJUSTMENT']),
  warehouseId: z.string().uuid(),
  items: z.array(z.object({
    itemCode: z.string().regex(/^[A-Z0-9-]+$/),
    quantity: z.number().positive().max(999999),
    unitCost: z.number().nonnegative()
  }))
});

app.post('/api/inventory/movements', (c) => {
  const validated = apiValidation.parse(c.req.body);
  // Proceed with business logic
});

// 3. BUSINESS LOGIC VALIDATION (Service Layer)
// Purpose: Check complex rules that need DB access
// Cost: 10-100ms (DB queries)
// Timing: After input validation

const validateMovement = async (movement) => {
  const errors = [];
  const warnings = [];
  
  // Check each item
  for (const item of movement.items) {
    // Rule 1: Item must exist
    const dbItem = await itemsRepo.findById(item.itemCode);
    if (!dbItem) errors.push(`Item ${item.itemCode} not found`);
    
    // Rule 2: Unit conversion must be valid
    const factor = await unitConversions.getFactor(
      item.unitOfEntry,
      dbItem.baseUnit
    );
    if (!factor) errors.push(`Unit conversion not found`);
    
    // Rule 3: Cost must be within variance
    if (Math.abs(item.unitCost - dbItem.standardCost) > threshold) {
      warnings.push(`Cost variance for ${item.itemCode}`);
    }
    
    // Rule 4: Stock would go below minimum (warning)
    const currentStock = await stockLedger.getBalance(
      movement.warehouseId,
      item.itemCode
    );
    const projectedStock = currentStock - item.quantity;  // For outbound
    if (projectedStock < dbItem.minStock) {
      warnings.push(`Stock below minimum after this move`);
    }
  }
  
  return { isValid: errors.length === 0, errors, warnings };
};

// 4. DATABASE CONSTRAINTS (D1 Level)
// Purpose: Last resort - prevent invalid data at database
// Cost: Free (constraint overhead)
// Timing: On INSERT/UPDATE

ALTER TABLE inventory_movements
  ADD CONSTRAINT chk_quantity CHECK (quantity > 0),
  ADD CONSTRAINT chk_cost CHECK (unit_cost >= 0),
  ADD CONSTRAINT fk_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  ADD CONSTRAINT fk_item FOREIGN KEY (item_id) REFERENCES items(code),
  ADD CONSTRAINT unique_document UNIQUE (document_type, document_id);
```

---

## 📈 Part 6: Caching Strategy

### **Multi-Level Cache**

```
┌─────────────────────────────────────────────────┐
│ LEVEL 1: Browser (React Query)                  │
│ TTL: 1-5 minutes                                │
│ Size: What the user is viewing                  │
│ Invalidate: On user action                      │
│                                                 │
│ Key: 'inventory-balances-wh-001'                │
│ Value: { itemCode: ..., qty: ..., ... }        │
│                                                 │
└─────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────┐
│ LEVEL 2: Cloudflare Workers KV                  │
│ TTL: 5-30 minutes                               │
│ Size: Most frequently accessed data              │
│ Invalidate: On API write                         │
│                                                 │
│ Key: 'wh:wh-001:stock'                          │
│ Value: Compressed JSON of all balances          │
│                                                 │
└─────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────┐
│ LEVEL 3: Database Materialized View             │
│ TTL: Real-time (calculated on demand)           │
│ Size: Complete stock_ledger_cache table         │
│ Indexes: On frequently queried columns          │
│                                                 │
│ SELECT * FROM stock_ledger_cache                │
│ WHERE warehouse_id = 'wh-001'                   │
│ AND on_hand_qty < min_stock_qty                │
│                                                 │
└─────────────────────────────────────────────────┘

INVALIDATION FLOW:
User submits movement
  ↓
API processes → writes to DB
  ↓
Triggers cache invalidation:
  1. Clear React Query: ['inventory-balances']
  2. Clear Workers KV: 'wh:wh-001:stock'
  3. DB: stock_ledger_cache is auto-updated on trigger
  ↓
Next read: Fetches fresh from Level 3 → Level 2 → Level 1
```

---

## 🎯 Part 7: Performance Targets

| Operation | Current | Target | Method |
|-----------|---------|--------|--------|
| List inventory (100 items) | 500ms | <200ms | Index + cache |
| Create movement | 1000ms | <500ms | Batch + optimize |
| Search item | 1000ms | <100ms | Full-text index |
| Calculate WAC | 2000ms | <500ms | Cached formula |
| Get stock balance | 800ms | <150ms | Materialized view |

---

## ✅ Summary

The recommended architecture:
1. **Separates concerns** (UI, API, Business, Data)
2. **Validates at multiple levels** (client, API, business, database)
3. **Caches aggressively** (3-level strategy)
4. **Audits everything** (compliance ready)
5. **Handles errors gracefully** (clear messages)
6. **Scales efficiently** (indexed queries, batching)

**Result:** Professional, maintainable, auditable system ✅

