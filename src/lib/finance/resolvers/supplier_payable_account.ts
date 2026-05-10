import type { D1Database } from '@cloudflare/workers-types'
import { resolveControlAccount } from '../../posting_engine'

const GENERIC_AP_ACCOUNT = '212000010'

/**
 * Resolve the AP credit account for a supplier transaction.
 *
 * Resolution cascade (first match wins):
 *  1. Supplier.gl_account_code — explicit per-supplier override
 *  2. BPG-specific control rule (mapping_key = bus_posting_group_code)
 *  3. Global accounts_payable control rule
 *  4. Hard-coded fallback (212000010 — موردون متنوعون)
 *
 * The old name-string matching against COA accounts has been removed.
 * BPG assignment (migration 0100) makes that lookup unnecessary.
 */
export async function resolveSupplierPayableAccount(
  db: D1Database,
  company_id: number,
  supplier_code?: number | string | null,
  _expense_category?: string | null, // retained for API compat — no longer used
): Promise<string> {
  const globalAp = await resolveControlAccount(db, company_id, 'accounts_payable') ?? GENERIC_AP_ACCOUNT

  if (supplier_code == null) return globalAp

  const supplier = await db
    .prepare(
      `SELECT code, gl_account_code, bus_posting_group_code
       FROM suppliers
       WHERE company_id = ? AND code = ?
       LIMIT 1`,
    )
    .bind(company_id, supplier_code)
    .first<{ code: number; gl_account_code: string | null; bus_posting_group_code: string | null }>()

  // Step 1: explicit per-supplier GL override
  if (supplier?.gl_account_code) {
    const direct = await resolveActiveLeafAccount(db, company_id, supplier.gl_account_code)
    if (direct) return direct
  }

  // Step 2: BPG-specific control rule (e.g. mapping_key = 'LABOR' for dedicated payroll AP)
  const bpg = supplier?.bus_posting_group_code
  if (bpg) {
    const bpgAccount = await resolveControlAccount(db, company_id, bpg)
    if (bpgAccount) return bpgAccount
  }

  // Step 3 & 4: global AP rule or hard fallback
  return globalAp
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
