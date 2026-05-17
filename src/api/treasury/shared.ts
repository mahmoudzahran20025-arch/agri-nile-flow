/**
 * treasury/shared.ts
 * ===================
 * Internal helpers shared across cash.ts and equity.ts.
 * Not exported from the router — internal use only.
 */

import type { Env } from '../../types'
import { tableExists } from '../../lib/utils/api_helpers'
import { z } from 'zod'

export function userMsg(err: { message?: string }): string {
  return (err.message ?? 'حدث خطأ').replace(/^[A-Z_]+:\s*/, '')
}

export async function ensureActiveCenterCode(
  db: Env['DB'],
  company_id: number,
  center_code: number,
): Promise<boolean> {
  const row = await db.prepare(
    'SELECT 1 AS ok FROM cost_centers WHERE company_id = ? AND CAST(code AS INTEGER) = ? AND is_active = 1 LIMIT 1'
  ).bind(company_id, center_code).first<{ ok: number }>()
  return !!row?.ok
}

export async function ensureActiveFinancialAccount(
  db: Env['DB'],
  company_id: number,
  financial_account_id: number,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS ok
     FROM bank_accounts b
     JOIN chart_of_accounts coa
       ON coa.company_id = b.company_id
      AND coa.code = b.gl_account_code
      AND coa.is_active = 1
      AND coa.is_header = 0
     WHERE b.company_id = ?
       AND b.id = ?
       AND b.is_active = 1
       AND b.gl_account_code IS NOT NULL
       AND TRIM(b.gl_account_code) <> ''
     LIMIT 1`
  ).bind(company_id, financial_account_id).first<{ ok: number }>()
  return !!row?.ok
}

export async function isSupplierAuthorizedForService(
  db: Env['DB'],
  company_id: number,
  supplier_code: number,
  service_type_code: string,
): Promise<boolean> {
  if (!(await tableExists(db, 'supplier_service_map'))) return true
  const row = await db.prepare(
    `SELECT 1 AS ok
     FROM supplier_service_map
     WHERE company_id = ? AND supplier_code = ? AND service_type_code = ? AND is_active = 1
     LIMIT 1`
  ).bind(company_id, supplier_code, service_type_code).first<{ ok: number }>()
  return !!row?.ok
}

export function cashNeedsOperationalDimensions(input: {
  direction: 'د' | 'م'
  center_code?: number | null
  supplier_code?: number | null
  partner_id?: number | null
  expense_code?: string | null
}): boolean {
  if (input.direction !== 'م') return false
  if (input.center_code != null) return true
  if (input.expense_code != null) return true
  return input.supplier_code == null && input.partner_id == null
}

export const transactionSchema = z.object({
  transaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD'),
  direction: z.enum(['د', 'م'], { message: "الاتجاه يجب أن يكون 'د' (دائن/وارد) أو 'م' (مدين/صادر)" }),
  amount: z.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
  narration: z.string().optional().nullable(),
  statement_text: z.string().optional().nullable(),
  recipient_name: z.string().optional().nullable(),
  document_number: z.number().optional().nullable(),
  supplier_code: z.number().optional().nullable(),
  center_code: z.number().optional().nullable(),
  field_id: z.number().optional().nullable(),
  season_id: z.number().optional().nullable(),
  status: z.enum(['draft', 'posted']).optional().default('posted'),
  notes: z.string().optional().nullable(),
  notes_internal: z.string().optional().nullable(),
  service_type_code: z.string().optional().nullable(),
  expense_code: z.union([z.string(), z.number()]).optional().nullable().transform(v => v == null ? null : String(v)),
  document_type: z.string().optional().nullable(),
  unit: z.string().optional().nullable(),
  quantity: z.number().optional().nullable(),
  unit_price: z.number().optional().nullable(),
  financial_account_id: z.number().optional().nullable(),
  partner_id: z.number().optional().nullable(),
})
