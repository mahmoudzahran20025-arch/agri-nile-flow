/**
 * Enhanced Ledger API with Server-Side Filtering & Search
 * =========================================================
 * Purpose: Move search/filter logic to backend
 * Problem: Current implementation loads page, filters locally → misses results on other pages
 * Solution: Include search and refType in queryKey + backend filtering
 * 
 * Status: Phase 3 implementation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { db } from '../../db';

const enhancedLedger = new Hono();

// =====================================================================
// Type Definitions
// =====================================================================

interface LedgerLineWithTrace {
  id: number;
  entry_id: number;
  account_code: string;
  debit: number;
  credit: number;
  narration: string;
  entry_desc: string;
  ref_type: string;
  ref_id: number;
  entry_date: string;
  center_code?: number;
  season_id?: number;
  field_id?: number;
  rule_slot?: string;
  source_record_id?: number;
  business_event_id?: string;
  rule_classification?: string;
}

interface LedgerResponse {
  account: {
    code: string;
    name: string;
    account_type: string;
  };
  lines: LedgerLineWithTrace[];
  total: number;
  page: number;
  size: number;
  total_pages: number;
  opening_balance: number;
  has_more: boolean;
  search_applied: string | null;
  ref_type_filter: string | null;
  matches_on_other_pages: number; // Count of matches outside current page
}

// =====================================================================
// SECTION 1: Enhanced Ledger Endpoint with Server-Side Filtering
// =====================================================================

/**
 * GET /api/gl/ledger/:code
 * 
 * Query parameters:
 *   - start: ISO date (optional)
 *   - end: ISO date (optional)
 *   - page: page number (1-based, default 1)
 *   - size: page size (default 100)
 *   - search: text search in narration/entry_desc/entry_id (optional)
 *   - refType: filter by ref_type (optional) - 'cash_transaction', 'supplier_transaction', 'inventory_movement', 'manual'
 * 
 * Example: /api/gl/ledger/511403?start=2025-01-01&end=2025-12-31&page=1&size=100&search=fuel&refType=cash_transaction
 */
enhancedLedger.get('/ledger/:code', async (c: Context) => {
  try {
    const code = c.req.param('code');
    const start = c.req.query('start') || '2000-01-01';
    const end = c.req.query('end') || '2099-12-31';
    let page = parseInt(c.req.query('page') || '1');
    const size = Math.min(parseInt(c.req.query('size') || '100'), 500); // Cap at 500
    const search = c.req.query('search')?.trim() || null;
    const refType = c.req.query('refType') || null;

    if (page < 1) page = 1;

    // Step 1: Verify account exists
    const account = await db
      .prepare(
        `SELECT code, name, account_type FROM chart_of_accounts 
         WHERE company_id = 1 AND code = ? LIMIT 1`,
      )
      .bind(code)
      .first();

    if (!account) {
      return c.json({ error: 'Account not found' }, 404);
    }

    // Step 2: Build dynamic WHERE clause for filtering
    const whereConditions = [
      `jel.account_code = ?`,
      `jel.company_id = 1`,
      `DATE(je.entry_date) BETWEEN ? AND ?`,
    ];

    const params: any[] = [code, start, end];

    // Add search filter if provided
    if (search) {
      whereConditions.push(
        `(LOWER(COALESCE(jel.description, '')) LIKE ? 
          OR LOWER(COALESCE(je.description, '')) LIKE ? 
          OR CAST(je.id AS TEXT) LIKE ?)`,
      );
      const searchPattern = `%${search.toLowerCase()}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    // Add ref_type filter if provided
    if (refType) {
      whereConditions.push(`je.ref_type = ?`);
      params.push(refType);
    }

    const whereClause = whereConditions.join(' AND ');

    // Step 3: Get total count of matching records
    const countResult = await db
      .prepare(
        `SELECT COUNT(*) as total FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = jel.company_id
         WHERE ${whereClause}`,
      )
      .bind(...params)
      .first();

    const totalRecords = (countResult as any).total || 0;
    const totalPages = Math.ceil(totalRecords / size);

    // Ensure page is not beyond total
    if (page > totalPages && totalPages > 0) {
      page = totalPages;
    }

    const offset = (page - 1) * size;

    // Step 4: Fetch paginated results with full trace metadata
    const query = `
      SELECT
        jel.id,
        jel.entry_id,
        jel.account_code,
        jel.debit,
        jel.credit,
        COALESCE(jel.description, '') as narration,
        COALESCE(je.description, '') as entry_desc,
        COALESCE(je.ref_type, 'manual') as ref_type,
        COALESCE(je.ref_id, 0) as ref_id,
        je.entry_date,
        jel.center_code,
        jel.season_id,
        jel.field_id,
        jel.rule_slot,
        jel.source_record_id,
        jel.business_event_id,
        jel.rule_classification,
        jel.posting_rule_id,
        jel.source_module,
        jel.generated_at
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = jel.company_id
      WHERE ${whereClause}
      ORDER BY je.entry_date DESC, je.id DESC, jel.id DESC
      LIMIT ? OFFSET ?
    `;

    const limitParams = [...params, size, offset];
    const lines = await db.prepare(query).bind(...limitParams).all();

    // Step 5: Calculate opening balance (entries before start date)
    const openingBalanceQuery = `
      SELECT
        SUM(COALESCE(debit, 0)) - SUM(COALESCE(credit, 0)) as balance
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id AND je.company_id = jel.company_id
      WHERE jel.account_code = ? AND jel.company_id = 1 AND DATE(je.entry_date) < ?
    `;

    const balanceResult = await db
      .prepare(openingBalanceQuery)
      .bind(code, start)
      .first();

    const openingBalance = (balanceResult as any).balance || 0;

    // Step 6: Count matches outside current page (for user awareness)
    const matchesOutsidePageCount = totalRecords - (offset + (lines as any[]).length);

    // Step 7: Format response
    const response: LedgerResponse = {
      account: {
        code: account.code,
        name: account.name,
        account_type: account.account_type,
      },
      lines: lines as LedgerLineWithTrace[],
      total: totalRecords,
      page,
      size,
      total_pages: totalPages,
      opening_balance: openingBalance,
      has_more: page < totalPages,
      search_applied: search,
      ref_type_filter: refType,
      matches_on_other_pages: matchesOutsidePageCount,
    };

    return c.json(response);
  } catch (error) {
    console.error('Ledger endpoint error:', error);
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

// =====================================================================
// SECTION 2: Trace Information Endpoint
// =====================================================================

/**
 * GET /api/gl/ledger/:code/trace-info
 * Returns trace completeness metrics for a given account
 */
enhancedLedger.get('/ledger/:code/trace-info', async (c: Context) => {
  const code = c.req.param('code');
  const start = c.req.query('start') || '2000-01-01';
  const end = c.req.query('end') || '2099-12-31';

  try {
    const stats = await db
      .prepare(
        `
      SELECT
        COUNT(*) as total_lines,
        SUM(CASE WHEN business_event_id IS NOT NULL THEN 1 ELSE 0 END) as with_business_event,
        SUM(CASE WHEN source_module IS NOT NULL THEN 1 ELSE 0 END) as with_source_module,
        SUM(CASE WHEN posting_rule_id IS NOT NULL THEN 1 ELSE 0 END) as with_posting_rule,
        SUM(CASE WHEN rule_classification IS NOT NULL THEN 1 ELSE 0 END) as with_classification
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      WHERE jel.account_code = ? AND jel.company_id = 1 
        AND DATE(je.entry_date) BETWEEN ? AND ?
    `,
      )
      .bind(code, start, end)
      .first();

    const totalLines = (stats as any).total_lines || 0;

    return c.json({
      trace_completeness: {
        total_lines: totalLines,
        with_business_event: (stats as any).with_business_event || 0,
        with_source_module: (stats as any).with_source_module || 0,
        with_posting_rule: (stats as any).with_posting_rule || 0,
        with_classification: (stats as any).with_classification || 0,
        coverage_pct:
          totalLines > 0
            ? Math.round(
                (((stats as any).with_business_event || 0) / totalLines) * 100 * 100,
              ) / 100
            : 0,
      },
    });
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

// =====================================================================
// SECTION 3: Bulk Ledger Export (CSV)
// =====================================================================

/**
 * GET /api/gl/ledger/:code/export
 * Export ledger as CSV with all trace metadata
 */
enhancedLedger.get('/ledger/:code/export', async (c: Context) => {
  const code = c.req.param('code');
  const start = c.req.query('start') || '2000-01-01';
  const end = c.req.query('end') || '2099-12-31';

  try {
    const query = `
      SELECT
        je.entry_date,
        je.id as entry_id,
        jel.id as line_id,
        COALESCE(je.ref_type, 'manual') as source_type,
        je.ref_id,
        COALESCE(jel.description, je.description, '') as description,
        jel.account_code,
        jel.debit,
        jel.credit,
        COALESCE(jel.center_code, '') as center_code,
        COALESCE(jel.season_id, '') as season_id,
        COALESCE(jel.field_id, '') as field_id,
        COALESCE(jel.business_event_id, '') as business_event_id,
        COALESCE(jel.source_module, '') as source_module,
        COALESCE(jel.rule_slot, '') as rule_slot,
        COALESCE(jel.rule_classification, '') as classification
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      WHERE jel.account_code = ? AND jel.company_id = 1
        AND DATE(je.entry_date) BETWEEN ? AND ?
      ORDER BY je.entry_date DESC, je.id DESC
    `;

    const lines = await db.prepare(query).bind(code, start, end).all();

    // Build CSV
    const headers = [
      'Date',
      'Entry ID',
      'Line ID',
      'Source Type',
      'Source Record ID',
      'Description',
      'Account',
      'Debit',
      'Credit',
      'Cost Center',
      'Season',
      'Field',
      'Business Event',
      'Source Module',
      'Rule Slot',
      'Classification',
    ];

    const csvLines = [headers.join(',')];

    for (const line of lines as any[]) {
      csvLines.push(
        [
          line.entry_date,
          line.entry_id,
          line.line_id,
          line.source_type,
          line.ref_id,
          `"${line.description.replace(/"/g, '""')}"`, // Escape quotes
          line.account_code,
          line.debit,
          line.credit,
          line.center_code,
          line.season_id,
          line.field_id,
          line.business_event_id,
          line.source_module,
          line.rule_slot,
          line.classification,
        ].join(','),
      );
    }

    const csv = csvLines.join('\n');

    return c.text(csv, 200, {
      'Content-Disposition': `attachment; filename="ledger-${code}-${start}-${end}.csv"`,
      'Content-Type': 'text/csv',
    });
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

export default enhancedLedger;
