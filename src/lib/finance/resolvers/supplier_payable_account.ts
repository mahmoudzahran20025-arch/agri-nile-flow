import type { D1Database } from '@cloudflare/workers-types'
import { resolveControlAccount } from '../../posting_engine'

const GENERIC_AP_ACCOUNT = '212000010'

/**
 * Resolve the AP credit account for a supplier transaction.
 *
 * Resolution cascade (first match wins):
 *  1. supplier_service_map exact match by supplier + service_type_code
 *  2. supplier_service_map primary mapping for single-service/default suppliers
 *  3. Supplier.gl_account_code — explicit per-supplier override
 *  4. BPG-specific control rule (mapping_key = bus_posting_group_code)
 *  5. Global accounts_payable control rule
 *  6. Hard-coded fallback (212000010 — موردون متنوعون)
 */
export async function resolveSupplierPayableAccount(
  db: D1Database,
  company_id: number,
  supplier_code?: number | string | null,
  _expense_category?: string | null, // retained for API compat — no longer used
  service_type_code?: string | null,
): Promise<string> {
  const globalAp = await resolveControlAccount(db, company_id, 'accounts_payable') ?? GENERIC_AP_ACCOUNT

  if (supplier_code == null) return globalAp

  const normalizedServiceType = service_type_code?.trim() || null
  const mappedAp = await resolveMappedSupplierAccount(db, company_id, supplier_code, normalizedServiceType)
  if (mappedAp) return mappedAp

  const supplier = await db
    .prepare(
      `SELECT code, gl_account_code, bus_posting_group_code
       FROM suppliers
       WHERE company_id = ? AND code = ?
       LIMIT 1`,
    )
    .bind(company_id, supplier_code)
    .first<{ code: number; gl_account_code: string | null; bus_posting_group_code: string | null }>()

  if (supplier?.gl_account_code) {
    const direct = await resolveActiveLeafAccount(db, company_id, supplier.gl_account_code)
    if (direct) return direct
  }

  const bpg = supplier?.bus_posting_group_code
  if (bpg) {
    const bpgAccount = await resolveControlAccount(db, company_id, bpg)
    if (bpgAccount) return bpgAccount
  }

  return globalAp
}

async function resolveMappedSupplierAccount(
  db: D1Database,
  company_id: number,
  supplier_code: number | string,
  service_type_code: string | null,
): Promise<string | null> {
  const hasMapTable = await tableExists(db, 'supplier_service_map')
  if (!hasMapTable) return null

  if (service_type_code) {
    const exact = await db.prepare(
      `SELECT default_ap_account_code
       FROM supplier_service_map
       WHERE company_id = ? AND supplier_code = ? AND service_type_code = ? AND is_active = 1
       LIMIT 1`
    ).bind(company_id, supplier_code, service_type_code).first<{ default_ap_account_code: string | null }>()
    const exactLeaf = await resolveActiveLeafAccount(db, company_id, exact?.default_ap_account_code)
    if (exactLeaf) return exactLeaf
  }

  const primary = await db.prepare(
    `SELECT default_ap_account_code
     FROM supplier_service_map
     WHERE company_id = ? AND supplier_code = ? AND is_active = 1
     ORDER BY is_primary DESC, id ASC
     LIMIT 1`
  ).bind(company_id, supplier_code).first<{ default_ap_account_code: string | null }>()

  return resolveActiveLeafAccount(db, company_id, primary?.default_ap_account_code)
}

async function tableExists(db: D1Database, tableName: string): Promise<boolean> {
  const row = await db.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
  ).bind(tableName).first<{ ok: number }>()
  return !!row?.ok
}

async function resolveActiveLeafAccount(
  db: D1Database,
  company_id: number,
  accountCode: string | null | undefined,
): Promise<string | null> {
  if (!accountCode) return null
  const row = await db
    .prepare(
      `SELECT code FROM chart_of_accounts
       WHERE company_id = ? AND code = ? AND is_active = 1 AND is_header = 0
       LIMIT 1`,
    )
    .bind(company_id, accountCode)
    .first<{ code: string }>()
  return row?.code ?? null
}
