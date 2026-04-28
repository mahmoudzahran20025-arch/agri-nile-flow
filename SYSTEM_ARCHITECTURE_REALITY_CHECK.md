AGRI-NILE FLOW — ENTERPRISE FINANCIAL SYSTEM REDESIGN
Principal Architect Document · Version 1.0 · 2026-04-28
SECTION 1 — SYSTEM NORTH STAR ARCHITECTURE
The Single Pipeline Law
Every monetary event in this system — without exception — must traverse exactly one pipeline:


┌─────────────────────────────────────────────────────────────────────┐
│                     THE CANONICAL PIPELINE                          │
│                                                                     │
│  Business       Posting       Journal      GL          Financial    │
│  Event     ──►  Engine   ──►  Entry   ──►  Ledger  ──►  Reports    │
│  (Source)       (Rules)       (Lines)      (Accounts)   (Derived)  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ FORBIDDEN: Any path that writes to GL bypassing this pipeline │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
Core Architectural Layers

┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 6 — PRESENTATION                                             │
│  React UI · Report Viewer · Rule Builder · Trace Explorer           │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 5 — API SURFACE                                              │
│  REST endpoints (all write-paths route through PostingEngine)       │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 4 — FINANCIAL REPORTS ENGINE                                 │
│  Balance Sheet · P&L · Trial Balance — ALL derived from GL only     │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 3 — GL LEDGER (SINGLE SOURCE OF TRUTH)                       │
│  journal_entries · journal_lines · accounts                         │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 2 — POSTING ENGINE (IMMUTABLE RULES CORE)                    │
│  Rule resolution · Double-entry generation · Validation gate        │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 1 — BUSINESS EVENT LAYER                                     │
│  inventory_events · supplier_events · cash_events · payroll_events  │
└─────────────────────────────────────────────────────────────────────┘
Forbidden Paths (Enforced by DB Constraints + API Guard)
Forbidden Path	Enforcement
Direct INSERT into journal_entries from business module	API guard: no endpoint accepts raw GL writes
journal_entry_lines modification after posting	DB trigger: RAISE(ABORT) if is_posted = 1
Cost center totals computed outside GL	Report engine reads ONLY journal_lines
Account balance stored on accounts table	No balance column exists on accounts
Posting group bypass via account_code direct reference	Engine always resolves via rules; hardcoded codes rejected
SECTION 2 — CANONICAL DATA MODEL
Design Principles
One table owns one truth. No column that can be derived exists twice.
Every monetary amount in the system has a journal_line_id ancestor.
All dimensions are on journal lines. Source tables carry only routing keys.
Core ERD

companies (1)
    │
    ├──► financial_periods (N)
    │         │
    │         └──► journal_entries (N) ──────────────────────────┐
    │                   │                                         │
    │                   └──► journal_lines (N)                   │
    │                             │                              │
    │                       account_code ──► accounts            │
    │                       center_code  ──► cost_centers        │
    │                       season_id    ──► seasons             │
    │                       field_id     ──► fields              │
    │                       source_event_id ──► business_events  │
    │                                                             │
    ├──► business_events (N) ──────────────────────────────────── │
    │         │                                                   │
    │         └── event_type (inventory|supplier|cash|payroll|manual)
    │         └── payload (JSON, immutable)                       │
    │         └── journal_entry_id FK ──────────────────────────► │
    │                                                             │
    ├──► posting_rules (N)                                        │
    │         └── rule_type (inventory|supplier|cash|payroll)     │
    │         └── dimension keys (bpg, ppg, ipg)                  │
    │         └── account slots (debit_account, credit_account)   │
    │                                                             │
    ├──► accounts (N)  [Chart of Accounts]                        │
    ├──► cost_centers (N)                                         │
    ├──► posting_groups (N) [business/product/inventory types]    │
    └──► items / warehouses / suppliers / employees               │
               (carry posting_group_code FK only)                 │
Table Definitions
accounts — Chart of Accounts

CREATE TABLE accounts (
  id               INTEGER PRIMARY KEY,
  company_id       INTEGER NOT NULL REFERENCES companies(id),
  code             TEXT    NOT NULL,
  name_ar          TEXT    NOT NULL,
  name_en          TEXT,
  account_type     TEXT    NOT NULL CHECK(account_type IN (
                     'asset','liability','equity','revenue','expense')),
  normal_balance   TEXT    NOT NULL CHECK(normal_balance IN ('debit','credit')),
  parent_code      TEXT    REFERENCES accounts(code),
  level            INTEGER NOT NULL DEFAULT 1,
  is_header        INTEGER NOT NULL DEFAULT 0,  -- 1 = no direct posting allowed
  is_system        INTEGER NOT NULL DEFAULT 0,  -- 1 = engine-managed, no UI edit
  is_active        INTEGER NOT NULL DEFAULT 1,
  allow_direct_posting INTEGER NOT NULL DEFAULT 1,
  UNIQUE(company_id, code)
);
financial_periods — Period Control

CREATE TABLE financial_periods (
  id               INTEGER PRIMARY KEY,
  company_id       INTEGER NOT NULL REFERENCES companies(id),
  fiscal_year      INTEGER NOT NULL,
  period_number    INTEGER NOT NULL,           -- 1-12 for monthly
  period_type      TEXT    NOT NULL CHECK(period_type IN ('monthly','quarterly','annual')),
  start_date       TEXT    NOT NULL,
  end_date         TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'open'
                   CHECK(status IN ('open','closing','closed','locked')),
  closed_at        TEXT,
  closed_by        INTEGER REFERENCES users(id),
  UNIQUE(company_id, fiscal_year, period_number)
);
business_events — Immutable Event Log

CREATE TABLE business_events (
  id               INTEGER PRIMARY KEY,
  company_id       INTEGER NOT NULL REFERENCES companies(id),
  event_type       TEXT    NOT NULL CHECK(event_type IN (
                     'inventory_receipt','inventory_issue','inventory_transfer',
                     'inventory_adjustment',
                     'supplier_invoice','supplier_payment','supplier_credit',
                     'cash_expense','cash_income','cash_transfer',
                     'payroll_run','payroll_payment',
                     'contract_advance','contract_settlement',
                     'manual_entry','period_close')),
  event_date       TEXT    NOT NULL,
  reference_number TEXT    NOT NULL,           -- human-readable doc number
  source_module    TEXT    NOT NULL,           -- 'inventory'|'suppliers'|'cash'|'hr'|'gl'
  source_id        INTEGER NOT NULL,           -- FK to source table (polymorphic)
  payload          TEXT    NOT NULL,           -- JSON snapshot at time of event
  posted_at        TEXT,
  posted_by        INTEGER REFERENCES users(id),
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  status           TEXT    NOT NULL DEFAULT 'pending'
                   CHECK(status IN ('pending','posted','reversed','error')),
  error_message    TEXT,
  reversal_of      INTEGER REFERENCES business_events(id),
  UNIQUE(company_id, source_module, source_id, event_type)  -- one event per source
);
journal_entries — GL Header

CREATE TABLE journal_entries (
  id               INTEGER PRIMARY KEY,
  company_id       INTEGER NOT NULL REFERENCES companies(id),
  period_id        INTEGER NOT NULL REFERENCES financial_periods(id),
  entry_number     TEXT    NOT NULL,           -- auto-generated: JE-2026-0001
  entry_date       TEXT    NOT NULL,
  description      TEXT    NOT NULL,
  source_event_id  INTEGER NOT NULL REFERENCES business_events(id),
  posting_rule_trace TEXT  NOT NULL,           -- JSON: which rule resolved this entry
  is_posted        INTEGER NOT NULL DEFAULT 0,
  is_reversing     INTEGER NOT NULL DEFAULT 0,
  reversed_by      INTEGER REFERENCES journal_entries(id),
  created_by       INTEGER NOT NULL REFERENCES users(id),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  posted_at        TEXT,
  posted_by        INTEGER REFERENCES users(id),
  UNIQUE(company_id, entry_number)
);
Critical constraint: source_event_id is NOT NULL and UNIQUE per journal_entries. One event produces exactly one journal entry. No event can produce two entries; no entry can exist without an event.

journal_lines — GL Detail (The ONLY Source of Truth for Amounts)

CREATE TABLE journal_lines (
  id               INTEGER PRIMARY KEY,
  entry_id         INTEGER NOT NULL REFERENCES journal_entries(id),
  company_id       INTEGER NOT NULL REFERENCES companies(id),
  line_number      INTEGER NOT NULL,
  account_code     TEXT    NOT NULL REFERENCES accounts(code),
  debit            REAL    NOT NULL DEFAULT 0 CHECK(debit >= 0),
  credit           REAL    NOT NULL DEFAULT 0 CHECK(credit >= 0),
  CHECK(debit > 0 OR credit > 0),
  CHECK(NOT (debit > 0 AND credit > 0)),  -- one side only
  description      TEXT,
  -- Dimensions (all optional, propagated from source event)
  center_code      INTEGER REFERENCES cost_centers(code),
  season_id        INTEGER REFERENCES seasons(id),
  field_id         INTEGER REFERENCES fields(id),
  warehouse_id     INTEGER REFERENCES warehouses(id),
  -- Traceability
  rule_slot        TEXT    NOT NULL,  -- 'inventory_account'|'purchases_account'|'cogs_account'|etc.
  UNIQUE(entry_id, line_number)
);
posting_rules — Single Source of Truth for Rule Resolution

CREATE TABLE posting_rules (
  id                    INTEGER PRIMARY KEY,
  company_id            INTEGER NOT NULL REFERENCES companies(id),
  rule_type             TEXT    NOT NULL CHECK(rule_type IN (
                          'inventory','supplier_invoice','supplier_payment',
                          'cash_expense','cash_income','payroll','sales')),
  -- Dimension keys (NULL = wildcard)
  bus_posting_group     TEXT    REFERENCES posting_groups(code),
  prod_posting_group    TEXT    REFERENCES posting_groups(code),
  inv_posting_group     TEXT    REFERENCES posting_groups(code),
  -- Account slots
  debit_account_1       TEXT    REFERENCES accounts(code),
  credit_account_1      TEXT    REFERENCES accounts(code),
  debit_account_2       TEXT    REFERENCES accounts(code),  -- for 3-line entries
  credit_account_2      TEXT    REFERENCES accounts(code),
  -- Account slot labels (for trace)
  debit_slot_1_label    TEXT    NOT NULL,  -- e.g. 'inventory_account'
  credit_slot_1_label   TEXT    NOT NULL,  -- e.g. 'purchases_account'
  -- Priority (lower = higher precedence)
  priority              INTEGER NOT NULL DEFAULT 100,
  is_active             INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);
-- Unique constraint prevents ambiguous rule resolution
CREATE UNIQUE INDEX uq_posting_rule ON posting_rules(
  company_id, rule_type,
  COALESCE(bus_posting_group, '__null__'),
  COALESCE(prod_posting_group, '__null__'),
  COALESCE(inv_posting_group, '__null__')
);
posting_groups — Unified Group Registry

CREATE TABLE posting_groups (
  code             TEXT    NOT NULL,
  company_id       INTEGER NOT NULL REFERENCES companies(id),
  group_type       TEXT    NOT NULL CHECK(group_type IN ('business','product','inventory')),
  name_ar          TEXT    NOT NULL,
  name_en          TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(company_id, code, group_type)
);
cost_centers

CREATE TABLE cost_centers (
  code             INTEGER NOT NULL,
  company_id       INTEGER NOT NULL REFERENCES companies(id),
  name_ar          TEXT    NOT NULL,
  name_en          TEXT,
  parent_code      INTEGER REFERENCES cost_centers(code),
  is_active        INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(company_id, code),
  UNIQUE(company_id, name_ar)
);
SECTION 3 — POSTING ENGINE REDESIGN (CORE)
Architecture Principle
The Posting Engine is a pure function:


PostingEngine(event: BusinessEvent, rules: PostingRule[]) → JournalEntry | PostingError
It has no side effects. It reads rules, it returns lines. The caller commits to DB.

Rule Resolution Algorithm

function resolveRule(
  db: Database,
  company_id: number,
  rule_type: RuleType,
  keys: { bpg?: string; ppg?: string; ipg?: string }
): PostingRule {

  // Step 1: Exact match (highest priority)
  let rule = findRule(db, company_id, rule_type, keys.bpg, keys.ppg, keys.ipg);
  if (rule) return rule;

  // Step 2: BPG wildcard (PPG + IPG exact, BPG = NULL)
  rule = findRule(db, company_id, rule_type, null, keys.ppg, keys.ipg);
  if (rule) return rule;

  // Step 3: PPG wildcard (BPG exact, PPG = NULL)
  rule = findRule(db, company_id, rule_type, keys.bpg, null, keys.ipg);
  if (rule) return rule;

  // Step 4: IPG wildcard
  rule = findRule(db, company_id, rule_type, keys.bpg, keys.ppg, null);
  if (rule) return rule;

  // Step 5: BPG + PPG wildcard
  rule = findRule(db, company_id, rule_type, null, null, keys.ipg);
  if (rule) return rule;

  // Step 6: Global default (all NULL)
  rule = findRule(db, company_id, rule_type, null, null, null);
  if (rule) return rule;

  // HARD FAIL — no silent defaults
  throw new PostingEngineError(
    `RULE_NOT_FOUND: No posting rule for type=${rule_type} ` +
    `bpg=${keys.bpg} ppg=${keys.ppg} ipg=${keys.ipg}. ` +
    `Transaction blocked. Configure posting setup before proceeding.`
  );
}
Engine Contract

interface PostingEngineResult {
  success: boolean;
  journalEntry?: {
    description: string;
    lines: JournalLine[];
    ruleTrace: RuleTrace;  // full audit of which rule was chosen and why
  };
  error?: PostingEngineError;
  warnings: string[];  // non-blocking advisories only
}

interface RuleTrace {
  rule_id: number;
  rule_type: string;
  matched_at_step: 1 | 2 | 3 | 4 | 5 | 6;  // which cascade step resolved it
  bpg_used: string | null;
  ppg_used: string | null;
  ipg_used: string | null;
  resolved_accounts: Record<string, string>;  // slot → account_code
  resolved_at: string;  // ISO timestamp
}
Validation Gates (all must pass before commit)

async function validatePostingResult(
  db: Database,
  company_id: number,
  lines: JournalLine[]
): Promise<ValidationResult> {
  const errors: string[] = [];

  // 1. Double-entry balance
  const totalDebit  = sum(lines.map(l => l.debit));
  const totalCredit = sum(lines.map(l => l.credit));
  if (Math.abs(totalDebit - totalCredit) > 0.001) {
    errors.push(`IMBALANCE: Dr=${totalDebit} Cr=${totalCredit}`);
  }

  // 2. All accounts exist, are active, and allow posting
  for (const line of lines) {
    const acct = await getAccount(db, company_id, line.account_code);
    if (!acct) errors.push(`ACCOUNT_MISSING: ${line.account_code}`);
    else if (!acct.is_active) errors.push(`ACCOUNT_INACTIVE: ${line.account_code}`);
    else if (acct.is_header) errors.push(`HEADER_ACCOUNT: ${line.account_code} is a group account`);
    else if (!acct.allow_direct_posting) errors.push(`POSTING_BLOCKED: ${line.account_code}`);
  }

  // 3. Period is open
  const period = await getPeriodForDate(db, company_id, lines[0].entry_date);
  if (!period) errors.push(`NO_PERIOD: No open period for this date`);
  else if (period.status !== 'open') errors.push(`PERIOD_CLOSED: ${period.id} status=${period.status}`);

  // 4. No zero-amount lines
  for (const line of lines) {
    if (line.debit === 0 && line.credit === 0) {
      errors.push(`ZERO_LINE: account ${line.account_code} has zero debit and credit`);
    }
  }

  return { valid: errors.length === 0, errors };
}
No-Bypass Guarantee
The only way to write to journal_entries is through PostingEngine.post(). The API layer exposes zero endpoints that accept raw journal entry data. Every endpoint that creates a monetary event calls PostingEngine.post() internally.

SECTION 4 — EVENT SOURCING LAYER
Design: Commands produce Events; Events produce Journal Entries

Command (HTTP request)
    │
    ▼
Command Handler (validates business logic)
    │
    ▼
BusinessEvent (written to business_events, status=pending)
    │
    ▼
PostingEngine.post(event)
    │
    ├── success → JournalEntry written, business_events.status = 'posted'
    └── failure → business_events.status = 'error', error_message stored
Event Storage (business_events table)
The payload column stores a complete JSON snapshot of the source record at the time of the event:


{
  "event_type": "inventory_receipt",
  "source_id": 1042,
  "snapshot": {
    "item_code": 15,
    "item_name": "بذور القمح",
    "quantity": 500,
    "unit_price": 12.50,
    "warehouse_id": 3,
    "supplier_code": 7,
    "prod_posting_group": "SEEDS",
    "inv_posting_group": "MAIN_WH"
  },
  "dimensions": {
    "center_code": 4,
    "season_id": 2,
    "field_id": 11
  },
  "resolved_rule": {
    "rule_id": 23,
    "step": 1,
    "bpg": "LOCAL_SUPPLIER",
    "ppg": "SEEDS",
    "ipg": "MAIN_WH"
  }
}
Event Replay
Any journal entry can be deleted and recreated by replaying its event:


async function replayEvent(db: Database, event_id: number): Promise<void> {
  // 1. Load the original event (immutable payload)
  const event = await db.get('SELECT * FROM business_events WHERE id = ?', event_id);

  // 2. Delete the linked journal entry (if any) — cascade deletes lines
  if (event.journal_entry_id) {
    await db.run('DELETE FROM journal_entries WHERE id = ? AND is_posted = 0',
      event.journal_entry_id);
  }

  // 3. Re-run posting engine on frozen payload
  const payload = JSON.parse(event.payload);
  const result = await PostingEngine.postFromPayload(db, event.company_id, payload);

  // 4. Update event link
  await db.run(
    'UPDATE business_events SET journal_entry_id = ?, status = ? WHERE id = ?',
    result.journalEntry.id, 'posted', event_id
  );
}
Audit Reconstruction
The full financial history can be reconstructed from business_events alone:

Take all events in chronological order
Run each through the posting engine
Sum the resulting journal lines by account
This is used for the integrity audit endpoint (GET /api/gl/audit/reconstruct).

SECTION 5 — INVENTORY → GL INTEGRATION MODEL
Valuation Method: Moving Weighted Average (MWA)

New Average Cost = (Current Stock Value + Incoming Value) / (Current Qty + Incoming Qty)
All issues are valued at the MWA cost at the time of issue. This is stored on the movement record to make it immutable (the cost at time of issue never changes retroactively).

Stock Movement → Journal Mapping
Event Type	Dr	Cr
Receipt from supplier	Inventory Account	Goods Received Not Invoiced (GRNI)
Supplier invoice matched to receipt	GRNI	Accounts Payable
Issue to field / COGS	COGS Account	Inventory Account
Transfer between warehouses	Inventory Account (dest)	Inventory Account (src)
Positive adjustment (count > book)	Inventory Account	Inventory Variance Account
Negative adjustment (count < book)	Inventory Variance Account	Inventory Account
Write-off	Inventory Write-off Expense	Inventory Account
GRNI (Goods Received Not Invoiced) Account
This is the critical architectural change from the current system. The current system posts Cr. Purchases Account on receipt, conflating receipt and invoice. The correct model uses GRNI:


Receipt:  Dr. Inventory  Cr. GRNI           (goods received, invoice pending)
Invoice:  Dr. GRNI       Cr. Accounts Payable (invoice matched, GRNI cleared)
This eliminates the phantom debit in COGS that occurs when goods arrive but invoices are delayed.

inventory_events Source Table

CREATE TABLE inventory_events (
  id               INTEGER PRIMARY KEY,
  company_id       INTEGER NOT NULL REFERENCES companies(id),
  event_type       TEXT    NOT NULL CHECK(event_type IN (
                     'receipt','issue','transfer','adjustment','write_off','opening')),
  event_date       TEXT    NOT NULL,
  reference_number TEXT    NOT NULL,
  item_code        INTEGER NOT NULL REFERENCES items(id),
  warehouse_id     INTEGER NOT NULL REFERENCES warehouses(id),
  dest_warehouse_id INTEGER REFERENCES warehouses(id), -- for transfers
  quantity         REAL    NOT NULL CHECK(quantity > 0),
  unit_cost        REAL    NOT NULL CHECK(unit_cost >= 0),
  total_value      REAL    GENERATED ALWAYS AS (quantity * unit_cost) STORED,
  -- Routing keys for posting engine
  prod_posting_group TEXT  REFERENCES posting_groups(code),
  inv_posting_group  TEXT  REFERENCES posting_groups(code),
  -- Dimensions
  center_code      INTEGER REFERENCES cost_centers(code),
  season_id        INTEGER REFERENCES seasons(id),
  field_id         INTEGER REFERENCES fields(id),
  -- Links
  supplier_event_id INTEGER REFERENCES supplier_events(id), -- for receipt matching
  business_event_id INTEGER REFERENCES business_events(id),
  status           TEXT    NOT NULL DEFAULT 'draft'
                   CHECK(status IN ('draft','posted','cancelled')),
  created_by       INTEGER NOT NULL REFERENCES users(id),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
Stock Balance: Derived from Events, Not Stored Separately

-- Stock balance view (replaces stock_quants)
CREATE VIEW stock_balances AS
SELECT
  company_id,
  warehouse_id,
  item_code,
  SUM(CASE WHEN event_type IN ('receipt','opening') THEN quantity
           WHEN event_type IN ('issue','transfer') THEN -quantity
           WHEN event_type = 'adjustment' THEN quantity  -- signed
           ELSE 0 END) AS qty_on_hand,
  SUM(CASE WHEN event_type IN ('receipt','opening') THEN total_value
           WHEN event_type IN ('issue','transfer') THEN -total_value
           WHEN event_type = 'adjustment' THEN total_value
           ELSE 0 END) AS value_on_hand
FROM inventory_events
WHERE status = 'posted'
GROUP BY company_id, warehouse_id, item_code;
For performance, a materialized cache table stock_quants is maintained by the posting engine and invalidated on each new event. It is never written to directly — it is always rebuilt from inventory_events.

Reconciliation Rule

inventory_events (posted) total value
  = GL journal_lines WHERE rule_slot = 'inventory_account' (net)

If delta > 0.01: RECONCILIATION_FAILURE alert
SECTION 6 — COST CENTER ACCOUNTING MODEL
The Problem with the Current System
The current cost center reports aggregate three separate streams (cash, supplier, inventory) with independent JOINs, creating risk of double-counting and making reconciliation impossible.

The New Model: Cost Centers Are GL Dimensions Only
Cost centers have no aggregation logic of their own. They are purely a filter on journal_lines.


-- Cost center report (the ONLY way to compute cost center totals)
SELECT
  cc.code,
  cc.name_ar,
  a.account_type,
  SUM(jl.debit  - jl.credit) AS net_debit,
  SUM(jl.debit)               AS total_debit,
  SUM(jl.credit)              AS total_credit
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.entry_id
JOIN accounts a         ON a.code = jl.account_code AND a.company_id = jl.company_id
JOIN cost_centers cc    ON cc.code = jl.center_code AND cc.company_id = jl.company_id
WHERE jl.company_id = :company_id
  AND je.is_posted = 1
  AND (:season_id IS NULL OR jl.season_id = :season_id)
  AND (:period_id IS NULL OR je.period_id = :period_id)
GROUP BY cc.code, a.account_type
ORDER BY cc.code, a.account_type;
This is the complete cost center logic. There is no other cost center logic anywhere in the system.

Dimension Propagation Rule
When the posting engine generates journal lines, it copies dimensions from the source event:


function propagateDimensions(event: BusinessEvent, line: JournalLine): JournalLine {
  return {
    ...line,
    center_code: event.dimensions?.center_code ?? null,
    season_id:   event.dimensions?.season_id   ?? null,
    field_id:    event.dimensions?.field_id    ?? null,
    warehouse_id: event.dimensions?.warehouse_id ?? null,
  };
}
No business module is responsible for attaching dimensions to GL lines — this is 100% handled by the posting engine using the event's dimension payload.

SECTION 7 — CHART OF ACCOUNTS SYSTEM
Hierarchy Model

Level 1: Account Class     (1xxxx Asset, 2xxxx Liability, 3xxxx Equity, 4xxxx Revenue, 5xxxx Expense)
Level 2: Account Group     (11xxx Current Assets, 12xxx Fixed Assets, ...)
Level 3: Account Sub-Group (111xx Cash & Equivalents, 112xx Receivables, ...)
Level 4: Posting Account   (11101 Petty Cash, 11102 Main Bank Account, ...)
Level 5: Sub-Account       (optional — for partner-specific or project-specific tracking)
Posting Restriction Rules
Account Level	is_header	allow_direct_posting	Who can post
1 (Class)	1	0	Nobody
2 (Group)	1	0	Nobody
3 (Sub-Group)	1	0	Nobody
4 (Posting)	0	1	Posting Engine only
5 (Sub-Account)	0	1	Posting Engine only
Manual journal entries (level 4/5): Allowed only for event_type = 'manual_entry', which requires ROLE: CHIEF_ACCOUNTANT permission.

System Accounts (is_system = 1, cannot be deleted or renamed via UI)
Code	Purpose
GRNI	Goods Received Not Invoiced clearing account
ROUNDING	Penny rounding differences
SUSPENSE	Unclassified postings (should always be zero at period close)
RETAINED_EARNINGS	Equity accumulation (auto-posted at year close)
YTD_EARNINGS	Current year P&L accumulation
Mapping Rules Ownership
One system owns account mapping. That system is posting_rules.

The legacy gl_account_mappings table is dropped. Any reference to it in the codebase is a compilation error.

SECTION 8 — POSTING RULES SYSTEM (SINGLE SOURCE OF TRUTH)
Rule Schema (already defined in Section 2)
The posting_rules table is the only configuration that determines which GL accounts are used for any transaction. It is:

Queryable (admin can view all rules)
Audited (all changes logged to audit_log)
Versioned (soft-delete + new insert, never UPDATE in place)
Debuggable (every resolution attempt is logged with the matched rule_id)
Rule Priority Matrix

Priority 1:  BPG + PPG + IPG exact match
Priority 2:  BPG + PPG (IPG wildcard)
Priority 3:  BPG + IPG (PPG wildcard)
Priority 4:  PPG + IPG (BPG wildcard)
Priority 5:  BPG only  (PPG + IPG wildcard)
Priority 6:  PPG only  (BPG + IPG wildcard)
Priority 7:  IPG only  (BPG + PPG wildcard)
Priority 8:  Global default (all wildcard)
Priority ∞:  HARD FAIL — no silent defaults
Rule Validation Engine
When a rule is saved:


async function validateRule(db: Database, rule: PostingRule): Promise<void> {
  // 1. All account codes must exist and be posting accounts
  const slots = [rule.debit_account_1, rule.credit_account_1,
                 rule.debit_account_2, rule.credit_account_2].filter(Boolean);
  for (const code of slots) {
    const acct = await getAccount(db, rule.company_id, code);
    if (!acct)           throw new Error(`Account ${code} does not exist`);
    if (acct.is_header)  throw new Error(`Account ${code} is a header account`);
    if (!acct.is_active) throw new Error(`Account ${code} is inactive`);
  }

  // 2. No two rules with identical key combination
  const conflict = await findRule(db, rule.company_id, rule.rule_type,
    rule.bus_posting_group, rule.prod_posting_group, rule.inv_posting_group);
  if (conflict && conflict.id !== rule.id) {
    throw new Error(`Rule conflict: identical keys already exist at rule_id=${conflict.id}`);
  }

  // 3. Posting groups must be active
  for (const [groupCode, groupType] of [
    [rule.bus_posting_group, 'business'],
    [rule.prod_posting_group, 'product'],
    [rule.inv_posting_group, 'inventory'],
  ]) {
    if (!groupCode) continue;
    const group = await getPostingGroup(db, rule.company_id, groupCode, groupType);
    if (!group?.is_active) throw new Error(`Posting group ${groupCode} is inactive`);
  }
}
Rule Debugging Mechanism
Every call to resolveRule() writes to posting_rule_resolutions:


CREATE TABLE posting_rule_resolutions (
  id              INTEGER PRIMARY KEY,
  company_id      INTEGER NOT NULL,
  resolved_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  rule_type       TEXT    NOT NULL,
  input_bpg       TEXT,
  input_ppg       TEXT,
  input_ipg       TEXT,
  resolution_step INTEGER,         -- 1-8 or null (=fail)
  matched_rule_id INTEGER REFERENCES posting_rules(id),
  result          TEXT    NOT NULL CHECK(result IN ('resolved','failed')),
  error_message   TEXT,
  journal_entry_id INTEGER REFERENCES journal_entries(id)
);
SECTION 9 — FINANCIAL STATEMENTS ENGINE
Principle: All Numbers Come From journal_lines
No financial statement reads from inventory_movements, cash_transactions, supplier_transactions, or any other source table. Every number is a SUM of journal_lines filtered by account type and period.

Trial Balance

SELECT
  a.code,
  a.name_ar,
  a.account_type,
  a.normal_balance,
  SUM(jl.debit)              AS period_debit,
  SUM(jl.credit)             AS period_credit,
  SUM(jl.debit - jl.credit)  AS net_movement,
  -- Opening balance (sum of all prior posted entries)
  (SELECT SUM(jl2.debit - jl2.credit)
   FROM journal_lines jl2
   JOIN journal_entries je2 ON je2.id = jl2.entry_id
   WHERE jl2.account_code = a.code
     AND jl2.company_id = :company_id
     AND je2.period_id < :period_id
     AND je2.is_posted = 1)  AS opening_balance,
  SUM(jl.debit - jl.credit) +
    COALESCE((SELECT SUM(jl2.debit - jl2.credit) ...), 0) AS closing_balance
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.entry_id AND je.is_posted = 1
JOIN accounts a ON a.code = jl.account_code AND a.company_id = :company_id
WHERE jl.company_id = :company_id
  AND je.period_id = :period_id
GROUP BY a.code
ORDER BY a.code;
Balance Sheet

Assets     = SUM(journal_lines WHERE account_type = 'asset')    [net debit]
Liabilities = SUM(journal_lines WHERE account_type = 'liability') [net credit]
Equity      = SUM(journal_lines WHERE account_type = 'equity')   [net credit]
            + YTD Net Income

ASSERTION: Assets = Liabilities + Equity (enforced, throws if violated)
P&L Statement

Revenue  = SUM(journal_lines WHERE account_type = 'revenue') [net credit]
Expenses = SUM(journal_lines WHERE account_type = 'expense') [net debit]
Net Income = Revenue - Expenses

Segmentation (optional):
  By season_id   → Season P&L
  By center_code → Cost Center P&L
  By field_id    → Field P&L
Strict Balancing Enforcement
The reports engine checks the accounting equation before returning any response:


if (Math.abs(assets - (liabilities + equity + ytdNetIncome)) > 0.01) {
  throw new ReportIntegrityError(
    `BALANCE_SHEET_IMBALANCE: Assets=${assets} ≠ L+E=${liabilities + equity + ytdNetIncome}. ` +
    `Difference=${assets - (liabilities + equity + ytdNetIncome)}. ` +
    `Run /api/gl/audit/imbalance to locate the broken entries.`
  );
}
The financial statements page shows a red banner and blocks export when this check fails.

SECTION 10 — AUDIT & RECONCILIATION ENGINE
Reconciliation 1: GL vs Inventory

-- GL inventory balance (from journal lines)
SELECT SUM(jl.debit - jl.credit) AS gl_inventory_value
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.entry_id AND je.is_posted = 1
JOIN accounts a ON a.code = jl.account_code
WHERE a.account_type = 'asset'
  AND jl.rule_slot = 'inventory_account'
  AND jl.company_id = :company_id;

-- Physical inventory value (from inventory_events)
SELECT SUM(total_value) AS physical_inventory_value
FROM inventory_events
WHERE event_type = 'receipt' AND status = 'posted' AND company_id = :company_id
MINUS
SELECT SUM(total_value) FROM inventory_events
WHERE event_type = 'issue' AND status = 'posted' AND company_id = :company_id;

-- Delta > 0.01 = RECONCILIATION_FAILURE
Reconciliation 2: GL vs Cost Centers
Since cost centers are derived purely from GL journal lines, this reconciliation is identity — the cost center totals always equal the GL totals for lines with a center_code. No separate reconciliation needed. This is the correctness proof of the design.

Orphan Detection

-- Journal entries with no source event (orphans)
SELECT je.id, je.entry_number, je.created_at
FROM journal_entries je
LEFT JOIN business_events be ON be.journal_entry_id = je.id
WHERE be.id IS NULL;

-- Business events that are posted but have no journal entry
SELECT be.id, be.event_type, be.event_date
FROM business_events be
WHERE be.status = 'posted' AND be.journal_entry_id IS NULL;

-- Journal entries that don't balance
SELECT je.id, je.entry_number,
       SUM(jl.debit) AS total_debit,
       SUM(jl.credit) AS total_credit,
       ABS(SUM(jl.debit) - SUM(jl.credit)) AS imbalance
FROM journal_entries je
JOIN journal_lines jl ON jl.entry_id = je.id
GROUP BY je.id
HAVING ABS(SUM(jl.debit) - SUM(jl.credit)) > 0.001;
These three queries are exposed at GET /api/gl/audit/orphans, run daily via a scheduled job, and alert the system administrator.

SECTION 11 — DATA INTEGRITY CONSTRAINTS
Database-Level Constraints

-- 1. Journal entry cannot be deleted if posted
CREATE TRIGGER prevent_posted_entry_delete
BEFORE DELETE ON journal_entries
WHEN OLD.is_posted = 1
BEGIN
  SELECT RAISE(ABORT, 'Cannot delete a posted journal entry');
END;

-- 2. Journal lines cannot be modified after posting
CREATE TRIGGER prevent_posted_line_update
BEFORE UPDATE ON journal_lines
WHEN (SELECT is_posted FROM journal_entries WHERE id = NEW.entry_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'Cannot modify lines of a posted journal entry');
END;

-- 3. Account balance validation at posting time
CREATE TRIGGER enforce_account_posting_allowed
BEFORE INSERT ON journal_lines
BEGIN
  SELECT CASE
    WHEN (SELECT is_header FROM accounts WHERE code = NEW.account_code
          AND company_id = NEW.company_id) = 1
    THEN RAISE(ABORT, 'Cannot post to a header account')
    WHEN (SELECT allow_direct_posting FROM accounts WHERE code = NEW.account_code
          AND company_id = NEW.company_id) = 0
    THEN RAISE(ABORT, 'Direct posting not allowed for this account')
  END;
END;

-- 4. Period must be open for new entries
CREATE TRIGGER enforce_open_period
BEFORE INSERT ON journal_entries
BEGIN
  SELECT CASE
    WHEN (SELECT status FROM financial_periods WHERE id = NEW.period_id) != 'open'
    THEN RAISE(ABORT, 'Cannot post to a closed or locked period')
  END;
END;

-- 5. Each business event produces at most one journal entry
-- Enforced by: business_events has UNIQUE(company_id, source_module, source_id, event_type)
-- And journal_entries has: UNIQUE source_event_id via FK + NOT NULL

-- 6. Prevent posting to suspense account at period close
CREATE TRIGGER prevent_suspense_at_close
BEFORE UPDATE ON financial_periods
WHEN NEW.status = 'closed'
BEGIN
  SELECT CASE
    WHEN EXISTS(
      SELECT 1 FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      WHERE jl.account_code = 'SUSPENSE'
        AND je.period_id = NEW.id
        AND (jl.debit != jl.credit OR jl.debit != 0)
    ) THEN RAISE(ABORT, 'Cannot close period with non-zero Suspense account balance')
  END;
END;
Application-Level Constraints
Rule	Where Enforced
Posting engine must succeed before any source table is written	Transaction wrapping in PostingEngine.post()
journal_entry_id on source tables is set atomically	Same DB transaction as journal entry creation
Business events are written before journal entries	Event is inserted first; if engine fails, event remains in error state
All monetary columns are REAL with CHECK > 0	DB schema
No NULL on required dimension FK when dimension is present	Application validation in command handlers
SECTION 12 — MULTI-TENANT ISOLATION MODEL
Tenant Scoping
Every table in the system has company_id. Every query MUST include WHERE company_id = :company_id derived from the authenticated JWT.

Application-level enforcement:


// Base query builder — company_id injected from auth context, NEVER from request body
class TenantQuery {
  constructor(private db: Database, private company_id: number) {}

  table(name: string) {
    return {
      select: (cols: string) =>
        this.db.prepare(`SELECT ${cols} FROM ${name} WHERE company_id = ?`),
      insert: (data: Record<string, unknown>) => {
        // Automatically injects company_id
        const withTenant = { ...data, company_id: this.company_id };
        // ... build INSERT
      }
    };
  }
}
API middleware:


app.use(async (c, next) => {
  const payload = verifyJWT(c.req.header('Authorization'));
  if (!payload?.company_id) return c.json({ error: 'UNAUTHORIZED' }, 401);
  c.set('company_id', payload.company_id);
  c.set('user_id', payload.user_id);
  await next();
});
Forbidden patterns:


// FORBIDDEN — company_id from request body
const id = c.req.json().company_id;  // Never

// REQUIRED — company_id from JWT only
const id = c.get('company_id');      // Always
Cache Isolation
The posting engine's rule cache is keyed by company_id:


const ruleCache = new Map<string, PostingRule[]>();
// Key format: `${company_id}:${rule_type}:${bpg}:${ppg}:${ipg}`
Cache TTL is 60 seconds. On any rule change, the cache for that company is fully invalidated.

SECTION 13 — MIGRATION STRATEGY
Phase 0 — Pre-Migration Audit (Day 1-2)

-- Count orphaned journal entries (no source event)
-- Count inventory movements with no journal_entry_id
-- Count imbalanced journal entries
-- Export full GL as CSV for manual verification
This produces a Data Quality Report that the client signs off on before migration proceeds.

Phase 1 — Schema Creation (Destructive)

-- Drop legacy tables (confirmed obsolete)
DROP TABLE IF EXISTS gl_account_mappings;    -- replaced by posting_rules
DROP TABLE IF EXISTS general_posting_setup;  -- replaced by posting_rules
DROP TABLE IF EXISTS inventory_posting_setup;-- replaced by posting_rules

-- Drop columns that stored derived values
-- accounts: no balance column (was never there — confirmed safe)
-- cost_centers: no totals columns (were never there — confirmed safe)

-- Create new canonical tables
CREATE TABLE business_events (...);         -- new
CREATE TABLE posting_rules (...);           -- replaces general_posting_setup + inventory_posting_setup
CREATE TABLE posting_groups (...);          -- consolidates 3 separate group tables
CREATE TABLE posting_rule_resolutions (...);-- new audit table

-- Add NOT NULL constraints to existing tables
ALTER TABLE journal_entries ADD COLUMN source_event_id INTEGER REFERENCES business_events(id);
ALTER TABLE journal_entries ADD COLUMN posting_rule_trace TEXT;

-- Add rule_slot to journal_lines
ALTER TABLE journal_lines ADD COLUMN rule_slot TEXT;
Phase 2 — Data Migration

-- 2a. Migrate posting groups to unified table
INSERT INTO posting_groups (code, company_id, group_type, name_ar, is_active)
SELECT code, company_id, 'business', name, is_active FROM business_posting_groups;

INSERT INTO posting_groups (code, company_id, group_type, name_ar, is_active)
SELECT code, company_id, 'product', name, is_active FROM product_posting_groups;

INSERT INTO posting_groups (code, company_id, group_type, name_ar, is_active)
SELECT code, company_id, 'inventory', name, is_active FROM inventory_posting_groups;

-- Drop legacy group tables
DROP TABLE business_posting_groups;
DROP TABLE product_posting_groups;
DROP TABLE inventory_posting_groups;

-- 2b. Migrate posting setup to unified posting_rules
INSERT INTO posting_rules (company_id, rule_type, bus_posting_group, prod_posting_group,
  debit_account_1, credit_account_1, debit_slot_1_label, credit_slot_1_label, priority)
SELECT company_id, 'supplier_invoice',
  bus_posting_group_code, prod_posting_group_code,
  purchases_account, NULL,
  'purchases_account', 'accounts_payable', 10
FROM general_posting_setup WHERE is_active = 1;

-- etc. for each rule type

-- 2c. Backfill source_event_id on existing journal entries
-- Create synthetic business_events for all existing posted journal entries
INSERT INTO business_events (company_id, event_type, event_date, reference_number,
  source_module, source_id, payload, status, journal_entry_id)
SELECT
  je.company_id,
  CASE je.ref_type
    WHEN 'cash_transaction'    THEN 'cash_expense'
    WHEN 'supplier_transaction' THEN 'supplier_invoice'
    WHEN 'inventory_movement'  THEN 'inventory_receipt'
    ELSE 'manual_entry'
  END,
  je.entry_date,
  je.entry_number,
  je.ref_type,
  COALESCE(je.ref_id, je.id),
  json_object('migrated', 1, 'original_entry_id', je.id),
  'posted',
  je.id
FROM journal_entries je
WHERE je.is_posted = 1;

UPDATE journal_entries SET source_event_id = (
  SELECT id FROM business_events WHERE journal_entry_id = journal_entries.id
);

-- 2d. Backfill rule_slot on existing journal_lines (best effort from account type)
UPDATE journal_lines SET rule_slot = 'migrated_unknown'
WHERE rule_slot IS NULL;
Phase 3 — Constraint Enforcement

-- Now enforce NOT NULL after backfill
-- SQLite: requires recreating tables for strict NOT NULL
-- For Cloudflare D1 (SQLite): use application-level validation

-- Add triggers (see Section 11)
-- Run integrity checks
SELECT COUNT(*) FROM journal_entries WHERE source_event_id IS NULL;
-- Must return 0 before proceeding
Phase 4 — Legacy Code Removal
Delete src/api/gl.ts route handlers that write directly to journal_entries
Delete any reference to gl_account_mappings, general_posting_setup, inventory_posting_setup
Redirect all old client API calls to new endpoints
Remove deprecated GL page components that use old mapping endpoints
Rollback Strategy
Phase 1-2 migrations run inside a single transaction. If any step fails, the entire migration rolls back. Before execution, a full D1 database export is taken. The rollback procedure is:


# D1 backup restore
wrangler d1 restore agri-nile-db --backup-id <pre-migration-backup-id>
SECTION 14 — API SURFACE REDESIGN
Design Principle: Commands, Not CRUD
The API surface is redesigned as command endpoints, not CRUD endpoints. You do not POST /journal_entries. You POST /inventory/receipts. The system creates the journal entry.

Business Event Endpoints (write paths)

POST /api/inventory/receipts          → records receipt, fires inventory_receipt event
POST /api/inventory/issues            → records issue, fires inventory_issue event
POST /api/inventory/transfers         → records transfer, fires inventory_transfer event
POST /api/inventory/adjustments       → records adjustment, fires inventory_adjustment event

POST /api/suppliers/invoices          → records invoice, fires supplier_invoice event
POST /api/suppliers/payments          → records payment, fires supplier_payment event
POST /api/suppliers/credits           → records credit memo, fires supplier_credit event

POST /api/cash/expenses               → records expense, fires cash_expense event
POST /api/cash/income                 → records income, fires cash_income event

POST /api/payroll/runs/:id/approve    → approves payroll, fires payroll_run event
POST /api/payroll/runs/:id/pay        → marks paid, fires payroll_payment event

POST /api/gl/manual-entries           → manual journal entry (CHIEF_ACCOUNTANT only)
GL Read Endpoints

GET /api/gl/accounts                  → chart of accounts
GET /api/gl/accounts/:code/ledger     → account ledger (all entries for one account)
GET /api/gl/periods                   → financial periods
GET /api/gl/entries                   → journal entries list (filterable)
GET /api/gl/entries/:id               → journal entry detail + lines + trace
GET /api/gl/entries/:id/trace         → full rule resolution trace
Financial Report Endpoints

GET /api/reports/trial-balance        → trial balance for period
GET /api/reports/balance-sheet        → balance sheet at date
GET /api/reports/income-statement     → P&L for period
GET /api/reports/cost-centers         → cost center P&L (GL-derived only)
GET /api/reports/season/:id/pl        → season P&L
Admin Endpoints

GET  /api/posting/rules               → list all posting rules
POST /api/posting/rules               → create rule (with validation)
PUT  /api/posting/rules/:id           → update rule (creates new version)
DELETE /api/posting/rules/:id         → deactivate rule (soft delete)

GET  /api/posting/groups              → list all posting groups
POST /api/posting/groups              → create group
PUT  /api/posting/groups/:id          → update group

POST /api/posting/simulate            → dry-run: "what would this event post to?"
GET  /api/posting/health              → posting setup completeness score
Forbidden Endpoints (must not exist)

POST /api/gl/entries        ← FORBIDDEN: bypasses posting engine
PUT  /api/gl/entries/:id    ← FORBIDDEN: journal entries are immutable
DELETE /api/gl/entries/:id  ← FORBIDDEN (unless is_posted = 0)
POST /api/gl/lines          ← FORBIDDEN: lines created only by engine
PUT  /api/accounts/balance  ← FORBIDDEN: balances are always derived
SECTION 15 — UX / USER EXPERIENCE DESIGN (DYNAMICS-LEVEL)
15.1 Posting Rule Builder

┌─────────────────────────────────────────────────────────────────────┐
│  POSTING RULE SETUP — Visual Builder                                │
│                                                                     │
│  Transaction Type:  [Supplier Invoice ▼]                            │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │  Business Group  │  │  Product Group   │  │  Inventory Group │  │
│  │  [LOCAL SUPP ▼]  │  │  [SEEDS      ▼]  │  │  [  (any)   ▼]  │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
│            │                    │                                   │
│            └────────────────────┘                                   │
│                      │                                              │
│                      ▼                                              │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  DEBIT:  [5100 - Purchases - Seeds          ▼] [Required]   │   │
│  │  CREDIT: [2100 - Accounts Payable           ▼] [Required]   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Resolution Preview:                                                │
│  ✅ Step 1 match: BPG=LOCAL_SUPP + PPG=SEEDS                       │
│  ✅ Accounts valid and active                                       │
│  ✅ No conflicts with existing rules                                │
│                                                                     │
│  [Save Rule]  [Test with Sample Transaction]                        │
└─────────────────────────────────────────────────────────────────────┘
15.2 Journal Entry Trace View ("Why did this post here?")

┌─────────────────────────────────────────────────────────────────────┐
│  JOURNAL ENTRY TRACE — JE-2026-0847                                 │
│                                                                     │
│  Source Event:  Inventory Receipt #INV-2026-0234                    │
│  Date:          2026-04-15    Posted by: Ahmad Hassan               │
│                                                                     │
│  RULE RESOLUTION TRACE:                                             │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │ Step 1: BPG=LOCAL_SUPP + PPG=SEEDS + IPG=MAIN_WH           │    │
│  │         → ❌ No exact match                                 │    │
│  │ Step 2: BPG=LOCAL_SUPP + PPG=SEEDS + IPG=(any)             │    │
│  │         → ✅ MATCHED Rule #23                               │    │
│  │            Dr. 1310 - Inventory: Seeds    500.00 EGP        │    │
│  │            Cr. 2101 - GRNI                500.00 EGP        │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  JOURNAL LINES:                                                     │
│  Dr. 1310 - Inventory: Seeds      500.00  [Cost Center: Field 4]   │
│  Cr. 2101 - GRNI                  500.00  [Cost Center: Field 4]   │
│                                     ──────                         │
│  Balance:                            0.00  ✅                       │
│                                                                     │
│  [View Source Event]  [View Posting Rule #23]  [Export PDF]        │
└─────────────────────────────────────────────────────────────────────┘
15.3 Posting Setup Health Dashboard

┌─────────────────────────────────────────────────────────────────────┐
│  POSTING SETUP HEALTH                           Score: 87/100       │
│                                                                     │
│  ✅ Supplier Invoice Rules     12/12 combinations covered           │
│  ✅ Inventory Receipt Rules     8/8  combinations covered           │
│  ⚠️  Inventory Issue Rules      6/8  — 2 combinations missing       │
│     → PPG=CHEMICALS + IPG=FIELD_STORE has no rule                  │
│     → PPG=FERTILIZER + IPG=(any) has no rule                       │
│  ✅ Cash Expense Rules          All covered                         │
│  ⚠️  Payroll Rules              Missing: social insurance account   │
│                                                                     │
│  [Fix Missing Rules →]                                              │
└─────────────────────────────────────────────────────────────────────┘
15.4 Account Ledger with Event Drilldown
Each row in the account ledger links back to its originating business event. Clicking a row opens the full event detail: source document, rule trace, and all related journal lines.

SECTION 16 — DEBUGGING & TRACEABILITY SYSTEM
"Why did this entry post here?" — Full Trace
The posting_rule_trace column on journal_entries stores the complete resolution trace as JSON:


{
  "resolved_at": "2026-04-15T10:32:11Z",
  "rule_type": "inventory_receipt",
  "input": { "bpg": "LOCAL_SUPP", "ppg": "SEEDS", "ipg": "MAIN_WH" },
  "resolution_steps": [
    { "step": 1, "bpg": "LOCAL_SUPP", "ppg": "SEEDS", "ipg": "MAIN_WH", "result": "no_match" },
    { "step": 2, "bpg": "LOCAL_SUPP", "ppg": "SEEDS", "ipg": null,      "result": "matched", "rule_id": 23 }
  ],
  "matched_rule": {
    "id": 23,
    "debit_slot": "inventory_account",
    "debit_code": "1310",
    "credit_slot": "grni_account",
    "credit_code": "2101"
  }
}
Replay Debugging Endpoint

POST /api/gl/debug/replay-event/:id

Response:
{
  "event_id": 1042,
  "original_entry_id": 847,
  "replayed_entry": { ... },
  "match": true,   // original and replayed entries produce identical lines
  "delta": null
}
If match: false, the delta field shows exactly which accounts differ and on which lines — used to detect when a rule change would retroactively change the meaning of past entries.

Rule Change Impact Analysis

GET /api/posting/rules/:id/impact?proposed_changes={...}

Response:
{
  "affected_events": 142,
  "affected_journal_entries": 142,
  "account_changes": [
    { "from": "5100", "to": "5200", "entry_count": 87, "total_debit": 45000 }
  ],
  "warning": "This rule change affects 142 posted entries. Changes apply prospectively only."
}
SECTION 17 — PERFORMANCE MODEL
Query Optimization
Problem: journal_lines will grow to millions of rows. Balance sheet queries summing all lines are expensive.

Solution: Period Balance Snapshots


CREATE TABLE period_account_balances (
  id           INTEGER PRIMARY KEY,
  company_id   INTEGER NOT NULL REFERENCES companies(id),
  period_id    INTEGER NOT NULL REFERENCES financial_periods(id),
  account_code TEXT    NOT NULL REFERENCES accounts(code),
  opening_dr   REAL    NOT NULL DEFAULT 0,
  opening_cr   REAL    NOT NULL DEFAULT 0,
  period_dr    REAL    NOT NULL DEFAULT 0,
  period_cr    REAL    NOT NULL DEFAULT 0,
  closing_dr   REAL    NOT NULL DEFAULT 0,
  closing_cr   REAL    NOT NULL DEFAULT 0,
  UNIQUE(company_id, period_id, account_code)
);
This table is written once when a period closes. Financial statements for closed periods read from this snapshot, not from journal_lines. Financial statements for the current open period still read journal_lines in real time.

Indexes

-- Hot query path: account ledger
CREATE INDEX idx_journal_lines_account ON journal_lines(company_id, account_code, entry_id);

-- Hot query path: cost center reports
CREATE INDEX idx_journal_lines_center ON journal_lines(company_id, center_code, entry_id)
  WHERE center_code IS NOT NULL;

-- Hot query path: event lookup
CREATE INDEX idx_business_events_source ON business_events(company_id, source_module, source_id);

-- Hot query path: period queries
CREATE INDEX idx_journal_entries_period ON journal_entries(company_id, period_id, is_posted);

-- Hot query path: season P&L
CREATE INDEX idx_journal_lines_season ON journal_lines(company_id, season_id, entry_id)
  WHERE season_id IS NOT NULL;
Posting Engine Caching

// Rule cache: keyed by company_id + rule signature, 60s TTL
// Account validation cache: keyed by company_id + account_code, 5min TTL
// Period lookup cache: keyed by company_id + date, 1min TTL

// All caches are a single Map<string, { value, expires_at }>
// Invalidated on: rule change, account change, period status change
Batching
Payroll runs and staging imports use batch posting:


async function batchPost(db: Database, events: BusinessEvent[]): Promise<BatchResult> {
  // All events posted in a single D1 transaction
  // Maximum batch size: 100 events (D1 row limit per transaction)
  // Returns per-event success/failure
}
SECTION 18 — FAILURE MODES & RECOVERY
Partial Posting Failure
The PostingEngine.post() method is atomic: it writes the business event, journal entry, and all lines inside a single database transaction. If any step fails, nothing is committed.


async function post(db: Database, event: BusinessEventInput): Promise<PostingResult> {
  return await db.transaction(async (tx) => {
    // 1. Write business event (status=pending)
    const eventId = await tx.insertBusinessEvent(event);

    // 2. Resolve rules (pure function, no DB writes)
    const resolution = PostingEngine.resolveRules(rules, event);
    if (!resolution.success) {
      await tx.updateEventStatus(eventId, 'error', resolution.error.message);
      throw resolution.error;  // rolls back transaction
    }

    // 3. Validate lines
    const validation = await validatePostingResult(tx, event.company_id, resolution.lines);
    if (!validation.valid) {
      throw new PostingEngineError(validation.errors.join('; '));
    }

    // 4. Write journal entry + lines
    const entryId = await tx.insertJournalEntry({ ...entry, source_event_id: eventId });
    await tx.insertJournalLines(resolution.lines.map(l => ({ ...l, entry_id: entryId })));

    // 5. Update business event → posted
    await tx.updateEventStatus(eventId, 'posted', null, entryId);

    // 6. Update source table with journal_entry_id
    await tx.updateSourceRecord(event.source_module, event.source_id, entryId);

    return { success: true, event_id: eventId, entry_id: entryId };
  });
}
Reversal System
Reversals are first-class events, not deletions:


async function reverseEntry(
  db: Database,
  journal_entry_id: number,
  reason: string,
  reversed_by: number
): Promise<PostingResult> {
  const original = await getJournalEntry(db, journal_entry_id);
  if (!original.is_posted) throw new Error('Can only reverse posted entries');

  // Create reversal event with swapped debits/credits
  const reversalEvent: BusinessEventInput = {
    event_type: 'reversal',
    source_module: original.source_module,
    source_id: original.source_id,
    reversal_of: original.source_event_id,
    lines: original.lines.map(l => ({
      ...l,
      debit: l.credit,
      credit: l.debit,
      description: `REVERSAL: ${l.description}`,
    })),
    description: `Reversal of ${original.entry_number}: ${reason}`,
  };

  return await post(db, reversalEvent);
}
Orphan Detection & Repair
The daily audit job (/api/gl/audit/repair) detects and logs orphaned records. It does not auto-repair — it flags them for manual review. The accountant sees a list of orphans in the audit dashboard and can choose to:

Create a synthetic event to link to an orphan journal entry
Void the orphan journal entry
Mark as "reviewed and accepted" (with justification)
SECTION 19 — SECURITY MODEL
Role Definitions
Role	Can Do
VIEWER	Read-only access to reports, entries, balances
DATA_ENTRY	Create business events (inventory, cash, supplier)
ACCOUNTANT	+ Approve events, view posting traces, manual entries for low-value
CHIEF_ACCOUNTANT	+ Manual journal entries, period close, rule override
ADMIN	+ Posting rule management, chart of accounts, posting groups
SUPER_ADMIN	+ Tenant management, system reset, audit log access
Posting Authorization Matrix
Action	Minimum Role
Create inventory movement	DATA_ENTRY
Create supplier invoice	ACCOUNTANT
Create cash expense	DATA_ENTRY
Approve payroll run	CHIEF_ACCOUNTANT
Create manual journal entry	CHIEF_ACCOUNTANT
Reverse a journal entry	CHIEF_ACCOUNTANT
Modify posting rules	ADMIN
Close a financial period	CHIEF_ACCOUNTANT
Lock a financial period	ADMIN
Replay/reconstruct events	ADMIN
Audit Logging Requirements
Every action that changes financial state writes to audit_log:

user_id, company_id, ip_address, device_id
action: POST_BUSINESS_EVENT | REVERSE_ENTRY | CLOSE_PERIOD | CHANGE_RULE
before_state (JSON), after_state (JSON)
rule_trace_id (for posting actions)
Audit log is append-only. No UPDATE or DELETE permitted on audit_log. The SUPER_ADMIN can read but not modify.

API Security

// Every write endpoint requires:
// 1. Valid JWT (checked by middleware)
// 2. Correct role (checked by permissionGuard)
// 3. Correct company_id scope (checked by tenantGuard)

app.post('/api/inventory/receipts',
  permissionGuard('DATA_ENTRY'),
  tenantGuard(),
  async (c) => { ... }
);

app.post('/api/gl/manual-entries',
  permissionGuard('CHIEF_ACCOUNTANT'),
  tenantGuard(),
  async (c) => { ... }
);
SECTION 20 — SYSTEM INTEGRITY SCORE
Automatic Health Scoring (computed daily, cached 1 hour)

interface IntegrityScore {
  overall: number;         // 0-100
  components: {
    posting_coverage:   number;  // % of transactions with journal_entry_id
    balance_integrity:  number;  // % of entries that are balanced
    orphan_score:       number;  // 100 - (orphan_count / total_entries * 100)
    reconciliation:     number;  // GL vs Inventory delta as % of total inventory value
    period_health:      number;  // 0 if any period has suspense balance; 100 if clean
    rule_coverage:      number;  // % of posting group combinations with active rules
  };
  alerts: IntegrityAlert[];
  computed_at: string;
}
Score Breakdown
Component	Weight	How Computed
Posting Coverage	30%	posted_events / total_events * 100
Balance Integrity	25%	balanced_entries / total_entries * 100
Orphan Score	20%	100 - (orphan_entries / total * 100)
GL-Inventory Reconciliation	15%	100 - (delta / inventory_value * 100)
Rule Coverage	10%	covered_combinations / total_combinations * 100
Alert Thresholds
Score	Status	Action
95-100	✅ Healthy	No action
80-94	⚠️ Warning	Notify accountant
60-79	🔴 Critical	Block period close
< 60	🚨 Emergency	Notify admin, lock new postings
API

GET  /api/gl/integrity/score          → current integrity score + alerts
GET  /api/gl/integrity/history        → score trend over last 30 days
POST /api/gl/integrity/run-full-audit → trigger full audit (ADMIN only)
The integrity score is displayed permanently in the top navigation bar of the application. It is the single most important number in the system — it answers the question "can I trust this data?" at a glance.

SUMMARY: THE 10 LAWS OF THIS SYSTEM

LAW 1:  Every monetary event produces exactly one business_event record.
LAW 2:  Every business_event produces exactly one journal_entry.
LAW 3:  Every journal_entry is balanced. Dr = Cr, always.
LAW 4:  journal_lines is the only source of truth for any financial number.
LAW 5:  posting_rules is the only source of truth for account mapping.
LAW 6:  Cost center totals are a filter on journal_lines. Nothing more.
LAW 7:  The posting engine has no silent defaults. It fails loudly or not at all.
LAW 8:  Posted entries are immutable. Corrections are reversals + new entries.
LAW 9:  The company_id on every record comes from the JWT. Never from the request.
LAW 10: Any accountant can trace any number to a business event in under 3 clicks.

IMPLEMENTATION DELTA (2026-04-28)

The Section 13 "next step" has been executed:

1. Added migration `migrations/0048_unified_posting_rules_and_business_events.sql`
  - Creates canonical `posting_rules`
  - Creates canonical `business_events`

2. Added migration `migrations/0049_migrate_legacy_posting_setup_to_posting_rules.sql`
  - Migrates `general_posting_setup` -> `posting_rules (rule_type='general')`
  - Migrates `inventory_posting_setup` -> `posting_rules (rule_type='inventory')`
  - Migrates `gl_account_mappings` -> `posting_rules (rule_type='control')`

3. Rewired posting engine internals in `src/lib/posting_engine.ts`
  - Resolvers now read from `posting_rules` instead of legacy setup tables
  - Added `resolveControlAccount()` for control/singleton accounts

4. Rewired posting bridge in `src/lib/finance_core.ts`
  - Posting-engine bridge functions now use `resolveControlAccount()`
  - Bridge functions now write `business_events` first, then post journal entries, then back-link event -> journal

This converts the core posting path to unified rules + event-first traceability while preserving the current API surface.