import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import type { Env } from '../types'
import { authMiddleware, getUser, roleGuard } from '../middleware/auth'

const classifier = new Hono<{ Bindings: Env }>()

classifier.use('*', authMiddleware)
classifier.use('*', roleGuard(['super_admin', 'company_admin', 'accountant']))

// 1. Get Unmapped Historical Phrases
classifier.get('/unmapped', async (c) => {
  const { company_id } = getUser(c)
  
  // We find distinct narrations in cash_transactions that do NOT contain ANY of the keywords
  // already defined in transaction_mapping_rules.
  const sql = `
    SELECT DISTINCT narration, COUNT(*) as occurrences, SUM(amount) as total_volume
    FROM cash_transactions
    WHERE company_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM transaction_mapping_rules r 
        WHERE r.company_id = cash_transactions.company_id
          AND instr(cash_transactions.narration, r.keyword) > 0
      )
    GROUP BY narration
    ORDER BY occurrences DESC, total_volume DESC
    LIMIT 200
  `
  
  const { results } = await c.env.DB.prepare(sql).bind(company_id).all()
  return c.json({ success: true, data: results })
})

// 2. Get Existing Mapping Rules
classifier.get('/rules', async (c) => {
  const { company_id } = getUser(c)
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, e.name as expense_name, s.name as supplier_name, p.name as partner_name
     FROM transaction_mapping_rules r
     LEFT JOIN expense_types e ON r.category_type = 'expense' AND r.target_id = e.code AND e.company_id = r.company_id
     LEFT JOIN suppliers s ON r.category_type = 'supplier' AND r.target_id = s.code AND s.company_id = r.company_id
     LEFT JOIN partners p ON r.category_type = 'partner' AND r.target_id = p.id AND p.company_id = r.company_id
     WHERE r.company_id = ?
     ORDER BY r.id DESC`
  ).bind(company_id).all()
  return c.json({ success: true, data: results })
})

const ruleSchema = z.object({
  keyword: z.string().min(2),
  category_type: z.enum(['expense', 'supplier', 'partner', 'bank', 'cost_center']),
  target_id: z.number(),
  direct_gl_account: z.string().optional().nullable()
})

// 3. Create Mapping Rule
classifier.post('/rules', zValidator('json', ruleSchema), async (c) => {
  const { company_id, sub: userId } = getUser(c)
  const b = c.req.valid('json')
  
  try {
    const res = await c.env.DB.prepare(
      `INSERT INTO transaction_mapping_rules (company_id, keyword, category_type, target_id, direct_gl_account, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(company_id, b.keyword, b.category_type, b.target_id, b.direct_gl_account || null, userId).run()
    
    return c.json({ success: true, data: { id: res.meta.last_row_id } }, 201)
  } catch (err: any) {
    if (err.message.includes('UNIQUE')) {
      return c.json({ success: false, error: 'هذه الكلمة المفتاحية موجودة مسبقاً' }, 400)
    }
    throw err
  }
})

// 4. Delete Mapping Rule
classifier.delete('/rules/:id', async (c) => {
  const { company_id } = getUser(c)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM transaction_mapping_rules WHERE id = ? AND company_id = ?').bind(id, company_id).run()
  return c.json({ success: true })
})

// 5. Retroactive Reconciler (Apply Rules to Past Data)
classifier.post('/reconcile-legacy', async (c) => {
  const { company_id } = getUser(c)

  // 1. Get all active rules
  const rules = await c.env.DB.prepare(
    `SELECT * FROM transaction_mapping_rules WHERE company_id = ?`
  ).bind(company_id).all<{
    keyword: string, category_type: string, target_id: number, direct_gl_account: string | null
  }>()

  if (!rules.results || rules.results.length === 0) {
    return c.json({ success: true, message: 'لا توجد قواعد للتطبيق' })
  }

  // 2. Get historical unclassified transactions
  const txns = await c.env.DB.prepare(
    `SELECT id, narration, direction FROM cash_transactions 
     WHERE company_id = ? AND status = 'posted'`
  ).bind(company_id).all<{ id: number, narration: string, direction: string }>()

  let updatedCount = 0

  for (const txn of txns.results || []) {
    // Find ALL matching rules (e.g., one for Supplier, one for Expense)
    const matchedRules = rules.results.filter(r => txn.narration.includes(r.keyword))
    if (matchedRules.length === 0) continue

    let glAccountCode: string | null = null
    const updates: string[] = []

    for (const rule of matchedRules) {
      if (rule.category_type === 'expense') updates.push(`expense_code = ${rule.target_id}`)
      if (rule.category_type === 'supplier') updates.push(`supplier_code = ${rule.target_id}`)
      if (rule.category_type === 'partner') updates.push(`partner_id = ${rule.target_id}`)

      if (rule.direct_gl_account) {
        glAccountCode = rule.direct_gl_account
      } else if (rule.category_type === 'expense') {
        const et = await c.env.DB.prepare('SELECT gl_account_code FROM expense_types WHERE code = ? AND company_id = ?').bind(rule.target_id, company_id).first<{gl_account_code: string}>()
        if (et?.gl_account_code) glAccountCode = et.gl_account_code
      }
    }

    if (updates.length > 0) {
      // deduplicate updates just in case
      const uniqueUpdates = [...new Set(updates)]
      await c.env.DB.prepare(`UPDATE cash_transactions SET ${uniqueUpdates.join(', ')} WHERE id = ?`).bind(txn.id).run()
    }

    // Rewrite the Journal Entry if we have a resolved GL account OR if it's a partner/supplier
    // For partner/supplier we fallback to the default GL mappings
    let finalGL = glAccountCode
    if (!finalGL) {
      const mappingKey = matchedRule.category_type === 'supplier' ? 'accounts_payable' : (matchedRule.category_type === 'partner' ? 'partner_current_account' : null)
      if (mappingKey) {
        const gm = await c.env.DB.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key = ?").bind(company_id, mappingKey).first<{account_code: string}>()
        finalGL = gm?.account_code || null
      }
    }

    if (finalGL) {
      // Find the associated journal entry lines
      // The default contra account used for legacy was either 'expense_default' or 'revenue_default'
      const defMapping = await c.env.DB.prepare("SELECT account_code FROM gl_account_mappings WHERE company_id = ? AND mapping_key IN ('expense_default', 'revenue_default')").bind(company_id).all<{account_code: string}>()
      const defCodes = defMapping.results?.map(r => r.account_code) || []

      if (defCodes.length > 0) {
        const qs = defCodes.map(() => '?').join(',')
        await c.env.DB.prepare(
          `UPDATE journal_entry_lines 
           SET account_code = ? 
           WHERE entry_id = (SELECT id FROM journal_entries WHERE ref_type = 'cash_transaction' AND ref_id = ?)
             AND account_code IN (${qs})`
        ).bind(finalGL, txn.id, ...defCodes).run()
      }
    }
    
    updatedCount++
  }

  return c.json({ success: true, updated_count: updatedCount })
})

export default classifier
