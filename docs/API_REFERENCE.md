# API Reference — Agri-Nile Flow v1.0
**Date:** May 6, 2026  
**Environment:** Production (https://agri-nile-flow.mahm-zahran22.workers.dev/api)  
**Status:** ✅ Complete (Post-deployment Phase)

---

## 📋 Quick Navigation
- [Authentication](#-authentication)
- [Config & Master Data](#-config--master-data)
- [Suppliers (AP)](#-suppliers-ap)
- [Inventory](#-inventory)
- [General Ledger](#-general-ledger)
- [Treasury (Cash)](#-treasury-cash)
- [Operations & Fields](#-operations--fields)
- [Fixed Assets](#-fixed-assets)
- [HR & Payroll](#-hr--payroll)
- [Finance](#-finance)
- [Admin](#-admin)
- [Reports](#-reports)

---

## 🔐 Authentication

### `POST /auth/login`
**Description:** User login with JWT token issuance  
**Auth:** None (public)  
**Request:**
```json
{
  "email": "admin@nawa.eg",
  "password": "Admin@2025",
  "company_id": 1
}
```
**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGci...",
    "user": {
      "id": 1,
      "full_name": "مالك التطبيق",
      "email": "admin@nawa.eg",
      "company_id": 1,
      "role": "super_admin"
    },
    "permissions": [
      "admin.audit",
      "admin.users",
      "config.read",
      "config.write",
      ...
    ]
  }
}
```

### `POST /auth/change-password`
**Description:** Change user password  
**Auth:** ✅ Bearer token required  
**Permission:** `auth.write`  
**Request:**
```json
{
  "current_password": "old_pass",
  "new_password": "new_pass"
}
```
**Response:** `200 OK` with success message

### `GET /auth/rbac-matrix`
**Description:** Get role-permission matrix for current user  
**Auth:** ✅ Bearer token required  
**Response:** `200 OK` with full RBAC configuration

---

## ⚙️ Config & Master Data

### `GET /config/equipment_types`
**Description:** List equipment types  
**Auth:** ✅ Bearer required  
**Permission:** `config.read`  
**Query Params:** `limit=5`, `offset=0`  
**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "company_id": 1,
      "name": "TRACTOR",
      "category": "machinery",
      "default_life_months": 120,
      "is_active": 1
    }
  ]
}
```

### `POST /config/equipment_types`
**Description:** Create new equipment type  
**Auth:** ✅ Bearer required  
**Permission:** `config.write`  
**Request:**
```json
{
  "name": "PUMP",
  "category": "irrigation",
  "default_life_months": 60,
  "asset_nature": "ماء"
}
```
**Response:** `201 Created`

### `PATCH /config/equipment_types/:id`
**Description:** Update equipment type  
**Auth:** ✅ Bearer required  
**Permission:** `config.write`  
**Request:** (partial updates)
```json
{
  "is_active": 0
}
```
**Response:** `200 OK`

---

## 👥 Suppliers (AP)

### `GET /suppliers`
**Description:** List all suppliers (paginated, enriched with balance)  
**Auth:** ✅ Bearer required  
**Permission:** `suppliers.read`  
**Query Params:** `limit=10`, `offset=0`, `status=ACTIVE`  
**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "code": "SUP001",
      "name": "موردون الشرقية",
      "email": "contact@suppliers.eg",
      "phone": "+20123456789",
      "open_balance": 15000,
      "contact_person": "أحمد محمود",
      "payment_terms": "30_days",
      "status": "ACTIVE"
    }
  ],
  "total": 11,
  "limit": 10,
  "offset": 0
}
```

### `POST /suppliers`
**Description:** Create new supplier (multi-tab form: Basic, Contact, Financial)  
**Auth:** ✅ Bearer required  
**Permission:** `suppliers.create`  
**Request:**
```json
{
  "code": "SUP012",
  "name": "موردون جدد",
  "email": "new@supplier.eg",
  "phone": "+201000000000",
  "country": "Egypt",
  "contact_person": "محمد علي",
  "position": "Sales Manager",
  "contact_phone": "+201111111111",
  "contact_email": "contact@supplier.eg",
  "account_code": "21010001",
  "payment_terms": "60_days",
  "currency": "EGP"
}
```
**Response:** `201 Created` with `id` and `code`

### `PATCH /suppliers/:id`
**Description:** Update supplier details  
**Auth:** ✅ Bearer required  
**Permission:** `suppliers.edit`  
**Request:** (partial updates)
```json
{
  "name": "موردون محدثون",
  "status": "INACTIVE"
}
```
**Response:** `200 OK`

### `GET /suppliers/aging`
**Description:** AP aging summary by supplier  
**Auth:** ✅ Bearer required  
**Permission:** `suppliers.read`  
**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "total_ap": 150000,
    "aging_buckets": {
      "current": 50000,
      "30_60_days": 40000,
      "60_90_days": 30000,
      "over_90_days": 30000
    },
    "by_supplier": [...]
  }
}
```

---

## 📦 Inventory

### `GET /inventory/items`
**Description:** List inventory items with stock balances  
**Auth:** ✅ Bearer required  
**Permission:** `inventory.read`  
**Query Params:** `warehouse=MAIN`, `status=ACTIVE`, `limit=20`  
**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "item_code": "RICE001",
      "name": "أرز أبيض",
      "warehouse": "MAIN",
      "balance_qty": 5000,
      "unit": "KG",
      "unit_cost": 2.5,
      "status": "ACTIVE"
    }
  ],
  "total": 150
}
```

### `POST /inventory/movements`
**Description:** Record inventory movement (GRN, Issue, Transfer, Adjustment)  
**Auth:** ✅ Bearer required  
**Permission:** `inventory.create`  
**Request:**
```json
{
  "item_code": "RICE001",
  "warehouse": "MAIN",
  "movement_type": "GRN",
  "quantity": 1000,
  "unit_cost": 2.5,
  "reference_id": 42,
  "narration": "استقبال من مورد الشرقية"
}
```
**Response:** `201 Created` with movement ID and posted GL entry ID

### `GET /inventory/analytics/cost-by-field`
**Description:** Field-wise cost breakdown (consumed items)  
**Auth:** ✅ Bearer required  
**Permission:** `inventory.read`  
**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "field_id": 1,
      "field_name": "حقل الشرقية",
      "total_cost": 45000,
      "items": [
        {
          "item_code": "FERT001",
          "name": "سماد يوريا",
          "qty_issued": 500,
          "cost": 20000
        }
      ]
    }
  ]
}
```

### `GET /inventory/analytics/reorder-alerts`
**Description:** Items below reorder point  
**Auth:** ✅ Bearer required  
**Permission:** `inventory.read`  
**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "item_code": "SEED001",
      "name": "بذور",
      "current_qty": 50,
      "min_qty": 100,
      "suggested_order_qty": 500,
      "warehouse": "MAIN"
    }
  ]
}
```

### `GET /inventory/governance/:id/resolve`
**Description:** Resolve GL posting error for movement (idempotent retry)  
**Auth:** ✅ Bearer required  
**Permission:** `inventory.create` / `finance.write`  
**Params:** `id` = movement ID  
**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Movement reposted successfully or already confirmed",
  "journal_entry_id": 5431
}
```

---

## 💰 General Ledger

### `GET /gl/entries`
**Description:** List posted journal entries (paginated, filterable)  
**Auth:** ✅ Bearer required  
**Permission:** `finance.read`  
**Query Params:** `from_date=2026-01-01`, `to_date=2026-05-06`, `limit=50`  
**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": 5401,
      "entry_date": "2026-05-01",
      "description": "استقبال من موردين",
      "ref_type": "supplier_invoice",
      "ref_id": 42,
      "debit_total": 25000,
      "credit_total": 25000,
      "is_posted": 1,
      "created_by": "admin@nawa.eg",
      "period_id": 14,
      "lines": [...]
    }
  ],
  "total": 342
}
```

### `POST /gl/entries`
**Description:** Create manual journal entry (admin only)  
**Auth:** ✅ Bearer required  
**Permission:** `finance.write`  
**Request:**
```json
{
  "entry_date": "2026-05-06",
  "description": "قيد يدوي - تصحيح",
  "lines": [
    {
      "account_code": "11010001",
      "debit": 5000,
      "credit": 0,
      "description": "تصحيح"
    },
    {
      "account_code": "51010001",
      "debit": 0,
      "credit": 5000,
      "description": "تصحيح"
    }
  ]
}
```
**Response:** `201 Created` with entry ID

### `GET /gl/orphans?limit=5`
**Description:** Find unbalanced GL entries (debit ≠ credit)  
**Auth:** ✅ Bearer required  
**Permission:** `finance.read`  
**Response:** `200 OK`
```json
{
  "success": true,
  "data": [],
  "total": 0
}
```

### `GET /gl/reconciliation/integrity`
**Description:** Full GL integrity audit (linked checks)  
**Auth:** ✅ Bearer required  
**Permission:** `finance.read`  
**Response:** `200 OK`
```json
{
  "success": true,
  "checks": {
    "total_entries": 342,
    "unbalanced_entries": 0,
    "orphan_lines": 0,
    "unlinked_movements": 0
  },
  "health_status": "EXCELLENT"
}
```

---

## 💳 Treasury (Cash)

### `GET /treasury/cash-accounts`
**Description:** List all cash accounts (bank, wallet, safe)  
**Auth:** ✅ Bearer required  
**Permission:** `treasury.read`  
**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "account_code": "11010001",
      "account_name": "بنك مصر",
      "account_type": "bank",
      "balance": 150000,
      "currency": "EGP"
    }
  ]
}
```

### `POST /treasury/cash-transactions`
**Description:** Record cash transaction (payment, receipt, transfer)  
**Auth:** ✅ Bearer required  
**Permission:** `treasury.create`  
**Request:**
```json
{
  "transaction_type": "payment",
  "cash_account_id": 1,
  "supplier_id": 3,
  "amount": 25000,
  "narration": "سداد فاتورة رقم 101",
  "transaction_date": "2026-05-06",
  "center_code": 1001,
  "season_id": 1,
  "reference_id": 101
}
```
**Response:** `201 Created` with transaction ID and GL entry ID

### `GET /treasury/cash-flow`
**Description:** Daily cash flow summary  
**Auth:** ✅ Bearer required  
**Permission:** `treasury.read`  
**Query Params:** `from_date=2026-05-01`, `to_date=2026-05-06`  
**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "opening_balance": 100000,
    "total_receipts": 50000,
    "total_payments": 40000,
    "closing_balance": 110000,
    "daily_breakdown": [...]
  }
}
```

---

## 🌾 Operations & Fields

### `GET /operations/fields`
**Description:** List all fields with seasonal info  
**Auth:** ✅ Bearer required  
**Permission:** `fields.read`  
**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "code": "FLD001",
      "name": "حقل الشرقية",
      "area_feddan": 10,
      "crop_name": "قمح",
      "season_id": 1,
      "center_code": 1001,
      "status": "ACTIVE"
    }
  ]
}
```

### `GET /operations/harvests`
**Description:** Harvest records with yield & cost data  
**Auth:** ✅ Bearer required  
**Permission:** `operations.read`  
**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "field_id": 1,
      "harvest_date": "2026-04-15",
      "crop_name": "قمح",
      "total_yield_qty": 800,
      "yield_unit": "KG",
      "total_cost": 15000,
      "total_revenue": 32000,
      "profit": 17000
    }
  ]
}
```

---

## 🔧 Fixed Assets

### `GET /assets`
**Description:** List fixed assets with GL linkage  
**Auth:** ✅ Bearer required  
**Permission:** `admin.read`  
**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "company_id": 1,
      "asset_code": "AST001",
      "name": "جرار",
      "category": "equipment",
      "acquisition_date": "2025-06-01",
      "cost": 100000,
      "salvage_value": 10000,
      "useful_life_months": 120,
      "depreciation_method": "straight_line",
      "journal_entry_id": 5431,
      "equipment_type_id": 1,
      "asset_status": "OPERATIONAL"
    }
  ]
}
```

### `POST /assets`
**Description:** Create fixed asset with depreciation schedule  
**Auth:** ✅ Bearer required  
**Permission:** `admin.write`  
**Request:**
```json
{
  "asset_code": "AST002",
  "name": "مضخة ري",
  "category": "equipment",
  "acquisition_date": "2026-01-01",
  "cost": 50000,
  "salvage_value": 5000,
  "useful_life_months": 60,
  "depreciation_method": "straight_line",
  "center_code": 1001,
  "field_id": 1,
  "notes": "مضخة ماء جديدة"
}
```
**Response:** `201 Created`

### `PATCH /assets/:id`
**Description:** Update asset details or mark for disposal  
**Auth:** ✅ Bearer required  
**Permission:** `admin.write`  
**Request:**
```json
{
  "name": "مضخة ري محدثة",
  "is_active": false
}
```
**Response:** `200 OK`

---

## 👨‍💼 HR & Payroll

### `GET /hr/employees`
**Description:** List employees with active status  
**Auth:** ✅ Bearer required  
**Permission:** `employees.read`  
**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "employee_code": "EMP001",
      "full_name": "أحمد محمود",
      "position": "مدير الحقول",
      "salary": 5000,
      "status": "ACTIVE"
    }
  ]
}
```

### `POST /hr/payroll-runs`
**Description:** Create and approve monthly payroll  
**Auth:** ✅ Bearer required  
**Permission:** `hr.write` / `treasury.approve` (for approval)  
**Request:**
```json
{
  "period_year": 2026,
  "period_month": 5,
  "employee_ids": [1, 2, 3]
}
```
**Response:** `201 Created`

---

## 📊 Reports

### `GET /reports/suppliers-balance`
**Description:** Supplier balance summary  
**Auth:** ✅ Bearer required  
**Permission:** `reports.read`  
**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "supplier_id": 1,
      "supplier_name": "موردون الشرقية",
      "total_invoiced": 200000,
      "total_paid": 185000,
      "open_balance": 15000
    }
  ]
}
```

---

## 🔧 Admin

### `GET /admin/system-status`
**Description:** System health check  
**Auth:** ✅ Bearer required  
**Permission:** `admin.audit`  
**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "database": "OK",
    "worker": "OK",
    "cache": "OK"
  }
}
```

### `GET /admin/audit-logs`
**Description:** User action audit trail  
**Auth:** ✅ Bearer required  
**Permission:** `admin.audit`  
**Query Params:** `limit=50`, `user_id=optional`, `from_date=optional`  
**Response:** `200 OK`

### `GET /admin/error-logs`
**Description:** System error logs  
**Auth:** ✅ Bearer required  
**Permission:** `admin.audit`  
**Response:** `200 OK`

---

## 🔄 Error Handling

### Standard Error Response
```json
{
  "success": false,
  "error": "الحقول المطلوبة: email, password",
  "code": "VALIDATION_ERROR"
}
```

### Common Status Codes
| Code | Meaning |
|------|---------|
| `200` | Success |
| `201` | Created |
| `400` | Bad Request (validation error) |
| `401` | Unauthorized (missing/invalid token) |
| `403` | Forbidden (insufficient permissions) |
| `404` | Not Found |
| `500` | Server Error |

---

## 📌 Authentication Header Template
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
```

---

## 🎯 Deployment Info
- **Base URL:** `https://agri-nile-flow.mahm-zahran22.workers.dev/api`
- **Frontend:** `https://feature-posting-engine-v2.agri-nile-flow-lake.pages.dev`
- **Last Updated:** May 6, 2026 (Post-Deployment Phase)
- **API Version:** v1.0
- **Status:** ✅ Production

---

*For questions or updates, refer to developer documentation in `docs/` folder.*
