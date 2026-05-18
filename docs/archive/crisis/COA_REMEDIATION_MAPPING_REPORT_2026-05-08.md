# COA Remediation Mapping Report (2026-05-08)

## Scope
- Baseline audit metrics before remediation:
  - parent_missing: 13
  - orphan_rules: 2
- Objective:
  - Phase 1: close structural CoA gaps safely.
  - Phase 2: close posting_rules orphan references safely.

## Phase 1 Mapping (parent_missing + malformed nodes)

### A) Missing parent nodes used by active children
| Missing parent code | Parent to create/attach | Type | Normal | Why |
|---|---|---|---|---|
| 1350 | parent 13 | asset | debit | child 13500001 points to 1350 |
| 1590 | parent 15 (created first) | asset | debit | child 15900001 points to 1590 |
| 2106 | parent 21 | liability | credit | child 21060001 points to 2106 |
| 5501 | parent 55 | expense | debit | children 55010001..55010005 point to 5501 |
| 6201 | parent 62 (created first) | expense | debit | children 62010001..62010003 point to 6201 |

### B) Intermediate headers required for valid hierarchy
| New header | Parent | Reason |
|---|---|---|
| 15 | 1 | required to host 1590 branch |
| 62 | 6 | required to host 6201 branch |

### C) Malformed / legacy imported nodes
| Code | Detected issue | Action |
|---|---|---|
| 7 | parent_code is literal string 'null' and has children | normalize parent_code to SQL NULL + force header |
| رقــم الــحـــســـاب | non-numeric malformed row with invalid parent رقــ | quarantine (inactive, detached, header) |

## Phase 2 Mapping (orphan_rules = 2)

### A) Affected rules
| Rule ID | Rule type | Product PG | Current inventory account | Issue |
|---|---|---|---|---|
| 77 | inventory | EQUIP_CAP | 14070301 | account missing in CoA |
| 78 | inventory | EQUIP_CONS | 14070302 | account missing in CoA |

### B) Deterministic remediation chosen
- Keep operational intent of rules 77/78 (do not remap to unrelated existing accounts).
- Create a dedicated inventory branch:
  - 140703 (header)
  - 14070301 (leaf)
  - 14070302 (leaf)
- Re-assert rule links explicitly:
  - rule 77 -> 14070301
  - rule 78 -> 14070302

## Implementation Files
- Phase 1 SQL: sql/coa_remediation_phase1_structure.sql
- Phase 2 SQL: sql/coa_remediation_phase2_orphan_rules.sql

## Verification Commands
- npm run verify:coa-governance
- npm run audit:coa:daily
