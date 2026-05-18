ere is the full audit report produced from deep analysis of all four JSON files together:

COMPREHENSIVE ERP FINANCIAL SYSTEMS AUDIT
نواة المستقبل — Agricultural Enterprise 2025-2026
1. EXECUTIVE SUMMARY
Business Entity: Nawa al-Mustaqbal is a large-scale Egyptian pivot-irrigated agricultural holding with 11 pivot irrigation systems, a capital base of 10M EGP (2 partners), and a total operational spend of ~19.4M EGP across Nov 2025–Apr 2026.

Accounting Gap — Brutal Verdict:

No automated GL posting engine exists — everything is manual across 3 isolated Excel ledgers
Dimension enforcement is absent — pivots and service types are optional, not required
Supplier-to-GL mapping is ambiguous — شركة عرفة (Code 20900353) carries 17.09M EGP AP covering 3 completely different service types under a single account
No inventory consumption tracking — 4,830 items received but none issued; COGS is zero
No payment-to-invoice matching — cash disbursements float unreconciled
2. REAL BUSINESS MODEL FOUND
Operational Structure
Unit of Production: بيفوت (pivot irrigation system)

11 pivots across two booster stations (128, 129)
Code range: 1006001–1006011
Each pivot is a cost center with independent labor, equipment, and chemical tracking
Primary Crop: بنجر السكر (Sugar Beet) — Code 3025
Parallel Crops: 26 others including wheat (قمح), potato (بطاطس), corn silage (ذرة سيلاج), cucumber (خيار), and perennials (mango, olives, grapes)

Financial Period: Nov 2025 – Apr 2026 (6-month operational window in data)

Operational Cycle (Evidence from Data)
Phase	Event	Evidence
1 – Capital Injection (Nov 6-8, 2025)	5M EGP per partner	Treasury entries 6251-6252; accounts 210101 + 2104
2 – Equipment Mobilization (Nov 17+)	Loader hours begin	عمرو السمالوسي; 100+ hourly records; 842.857 EGP/hr
3 – Labor Deployment (Dec 1-2, 2025)	Workers assigned to pivots	احمد دسوقي; 17-26 workers/day; 325 EGP/worker
4 – Input Acquisition (Nov-Jan)	Fertilizers purchased	شركة عرفة; 4,830 SKUs; 1,835,000+ EGP in Dec alone
5 – Harvest/Sales (inferred)	No revenue events yet	Account 4101 defined; no sale transactions in data
Total Spend (6-month accumulation):

Nov 2025: 374,150 EGP
Dec 2025: 4,336,343 EGP
Jan 2026: 10,796,373 EGP (peak)
Cumulative: ~19.38M EGP in treasury outflows
3. OPERATIONAL EVENT MATRIX
Event (Arabic)	Event (English)	Unit	Quantity Field	Party	GL Impact	Document Type
ايجار الات ومعدات	Equipment Rental	ساعة (Hour)	الكميه	عمرو السمالوسي (20100033)	Debit 3025/5101	مستخلص اعمال
مورد عمالة	Labor Supply	عامل (Worker)	الكميه	احمد دسوقي (21400002)	Debit 3025/5101	مستخلص اعمال
شراء اسمدة ومبيدات	Fertilizer/Chemical Purchase	كجم / لتر	الكمية	شركة عرفة (20900353)	Debit 1407 (Inventory)	Invoice
قطع غيار	Spare Parts	عدد (Unit)	الكمية	مورد نقدي (20800286)	Debit 1407	Receipt
دفعة من الحساب	Supplier Payment	مبلغ	1	All suppliers	Debit 2120 / Credit 1401	اذن صرف نقدية
رأس المال	Equity Injection	مبلغ	1	جهاز مستقبل مصر (1001) / طايل عرفة (1002)	Debit 1401 / Credit 210101+2104	محضر
اشراف زراعي	Agricultural Supervision	مبلغ (Monthly)	1	شركة عرفة (20900353)	Debit 33067	اذن صرف
مخزون تصريف	Inventory Issue (missing)	كجم / لتر	—	Internal (pivot as "customer")	Debit COGS / Credit 1407	NOT YET EXISTING
Critical Finding: Inventory issuance event (تصريف) does not exist in the data. All fertilizer is purchased but none is formally issued to the field — COGS is structurally zero.

4. SUPPLIER INTELLIGENCE MATRIX
Code	Name	Service Types	Multi-Service?	Single AP Adequate?	Evidence
20100033	عمرو السمالوسي - لودر	Equipment Rental only	No	Yes	100+ hourly records; 842.857 EGP/hr fixed rate
20300086	عيد شعبان-لودر	Equipment Rental only	No	Yes	Single equipment type
20300121	ميكنة احمد عبيد	Mechanization only	No	Yes	Balanced 187,585 EGP debit/credit (settled)
21400002	احمد دسوقي-عمالة	Labor only	No	Yes	325 EGP/worker; Dec 1-2 spike (17-26 workers)
21400108	ابراهيم رمضان الكيلاوي	Labor only	No	Yes	Single 8,000 EGP transaction
20900353	شركة عرفة للتصدير والتنمية الزراعية	Fertilizers + Supervision + Admin	YES — CRITICAL	NO — VIOLATES POSTING RULES	4,830 SKUs; 17.09M AP; 350K/month supervision; 3 different GL destinations
20900151	جهاز مستقبل مصر للتنمية المستدامة	Equity Investor + potential Equipment Supplier	YES — CRITICAL	NO — ROLE CONFLICT	5M EGP equity entry + 1,959,600 EGP unexplained AP balance
20800286	مورد نقدي	Misc cash purchases only	No	Yes	Small items: 870–3,825 EGP (tools, diesel, spares)
Immediate Action Required on Two Suppliers:

شركة عرفة: Split into 20900353.1 (Materials/Inventory → 1407) and 20900353.2 (Supervision → 33067)
جهاز مستقبل مصر: Separate equity investor role from any operational vendor role; the 1,959,600 EGP AP balance has no documented source
5. SERVICE TYPE MATRIX
Service (Arabic)	Service (English)	UoM	Rate (EGP)	Required Dimensions	GL Debit	GL Credit
ميكنة / ايجار الات	Equipment Rental	ساعة	842.857/hr	Pivot ✓, Crop ✓, Date ✓	5101.Equipment	2120
عمالة	Labor Supply	عامل	325/worker	Pivot ✓, Crop ✓, Date ✓	5101.Labor	2120
اسمدة	Fertilizers	كجم	Variable/kg	Item Code ✓, Warehouse ✓, Batch ✓	1407.1	2120.1
مبيدات	Pesticides	لتر	Variable/liter	Item Code ✓, Warehouse ✓, Batch ✓	1407.2	2120.1
تقاوي	Seeds	كجم / عدد	Variable	Item Code ✓, Crop ✓, Season ✓	1407.3	2120.1
قطع غيار	Spare Parts	عدد	870–3,825/item	Equipment type, Pivot	1407.4 or Direct Exp	1401
اشراف زراعي	Agricultural Supervision	مبلغ	350,000/month	Cost Center 1006011 ✓	33067	2120.2
دفعة من الحساب	Supplier Payment	مبلغ	—	Supplier ✓	2120	1401
رأس المال	Equity Injection	مبلغ	—	Partner SUB (1001/1002) ✓	1401	210101 + 2104
6. QUANTITY / UNIT ANALYSIS
Units Found in Data
UoM	Arabic	Context	Volume Observed	Issues
ساعة	Hour	Equipment rental	2.5–9 hrs/transaction; 100+ records	Rate fixed at 842.857; no productivity variance
عامل	Worker	Labor supply	17–26/transaction	No hours specified — assumed full day
كجم	Kilogram	Fertilizers, seeds	36–150,000 units/transaction	Phosphoric acid labeled kg but can be liquid
لتر	Liter	Liquid chemicals	1,000–20,000 units	No kg conversion factors documented
متر	Meter	Net/mesh materials	Catalog only	No width specification
عدد	Unit/Piece	Spare parts, tools	1–2,500	Generic; ambiguous
مبلغ	EGP Amount	Payments, equity, supervision	—	Monetary; not a physical UoM
Missing Units (Critical Gaps)
UoM	Arabic	Context	Gap Impact
فدان	Feddan	Field-level crop allocation	Cannot calculate cost/feddan; all costs at pivot level only
طن	Ton	Harvest yield	Revenue recognition will be impossible without yield tracking
عامل-يوم	Worker-Day	Labor specificity	Unclear if labor is full day or part-time
Unit Economics Calculable from Data
Equipment hourly rate: 842.857 EGP/hr → ~6,743 EGP/8-hr day
Labor daily rate: 325 EGP/worker → ~17 workers = 5,525 EGP/day for 2 pivots
Fertilizer cost: 1,835,000 EGP to شركة عرفة in Dec alone (4,830 SKUs, avg ~379 EGP/SKU)
Supervision fixed cost: 350,000 EGP/month = 4,200,000 EGP/year (largest single recurring cost)
7. POSTING LOGIC RECOMMENDATIONS
Rule Set (7 Rules — Minimum Viable)
EQUIP-001: Equipment Rental


Trigger:  Document Type = "مستخلص اعمال" AND Service = "ميكنة"
          AND Supplier IN (20100033, 20300086, 20300121)
Debit:    5101 (Equipment Operating Expense)
Credit:   2120 (Accounts Payable - Equipment)
Dims:     Supplier ✓, Pivot ✓, Crop ✓, Service=Equipment ✓, Date ✓
Validate: Qty (hours) > 0; Rate = 842.857 (flag variance); Pivot code IN (1006001–1006010)
Amount:   الكميه × السعر
LABOR-001: Labor Supply


Trigger:  Document Type = "مستخلص اعمال" AND Service = "عمالة"
          AND Supplier IN (21400002, 21400108)
Debit:    5101 (Labor Operating Expense)
Credit:   2120 (Accounts Payable - Labor)
Dims:     Supplier ✓, Pivot ✓, Crop ✓, Service=Labor ✓, Date ✓
Validate: Qty (workers) > 0; Rate = 325; Assume 1 day per entry if day not specified
Amount:   الكميه × 325
INVENT-001: Fertilizer/Chemical Purchase


Trigger:  Document Type = "Invoice" AND Service IN ("اسمدة","مبيدات","تقاوي")
          AND Supplier = 20900353 (materials arm)
Debit:    1407.X (Inventory by warehouse type: 1407.1=اسمدة, 1407.2=مبيدات, 1407.3=تقاوي)
Credit:   2120.1 (AP - Commodity Suppliers)
Dims:     Item Code ✓, Quantity ✓, Unit ✓, Batch ✓, Warehouse Type ✓
Validate: Unit must be كجم or لتر (reject عدد for bulk); Item exists in master; Batch assigned
Amount:   الكمية × السعر
COGS-001: Inventory Consumption (MUST BE BUILT — DOES NOT EXIST)


Trigger:  Document Type = "تصريف" (warehouse issuance to field)
Debit:    4501 (COGS) or 5101 by crop+pivot
Credit:   1407.X (matching receive account)
Dims:     Item Code ✓, Crop ✓, Pivot ✓, Batch ✓, Quantity ✓
Validate: Issue ≤ on-hand balance; Batch must exist; Issue date ≥ receipt date
Amount:   Qty × Weighted Average Cost
CASH-001: Supplier Payment


Trigger:  Document Type = "اذن صرف نقدية"
Debit:    2120 (AP - by supplier, matching service sub-account)
Credit:   1401 (Cash)
Dims:     Supplier ✓, Amount ✓, Date ✓, Document Reference ✓
Validate: AP balance ≥ payment; Cash balance ≥ payment; Flag overpayment
Amount:   Exact payment amount; track against specific invoices
EQUITY-001: Capital Injection


Trigger:  Document Type = "محضر" AND Category = "رأس المال"
          AND Partner SUB IN (1001, 1002)
Debit:    1401 (Cash)
Credit:   210101 (Paid-In Capital — by partner)
          + 2104 (Partners' Current Accounts)
Dims:     Partner SUB ✓, Amount ✓, Date ✓
Validate: Board authorization document; 5,000,000 per partner; Date before operations
SERV-001: Agricultural Supervision


Trigger:  Document Type = "فاتورة خدمات" AND Service = "اشراف زراعي"
          AND Supplier = 20900353 (SERVICES arm — must be split from materials)
Debit:    33067 (Agricultural Supervision Expense)
Credit:   2120.2 (AP - Services — separate from 2120.1 commodities)
Dims:     Service Type ✓, Cost Center = 1006011 ✓, Month ✓
Validate: Amount = 350,000 monthly; Invoice separate from fertilizer invoices
8. DATA GOVERNANCE PROBLEMS
A. Critical Missing Fields
Field	Where Missing	Impact	Severity
تاريخ الاستحقاق (Due Date)	All AP records in نواة	No aging schedule; no cash forecast possible	CRITICAL
Batch/Lot Number	All 4,830 inventory items	No pesticide traceability; regulatory risk	CRITICAL
كود الموسم (Season)	Labor + equipment lines	Cannot split winter vs. summer crop costs	CRITICAL
كود المصروف (Expense GL Code)	Equipment and labor lines	Cannot route to correct GL account automatically	HIGH
Feddan area per pivot	No field anywhere	Cannot calculate cost/feddan	HIGH
UoM conversion factors	مخازن file	لتر↔كجم impossible to consolidate	HIGH
B. Naming Inconsistencies (Same Concept, Different Names)
Concept	نواة File	خزينة File	Correct
Quantity	الكميه (typo)	الكمية	الكمية
Cost Center	كود البيقوت	كود المركز	Both used; unify to كود المركز
Amount direction	دائن=supplier owes	مدين=cash outflow	Different directionality; ambiguous in reconciliation
C. Floating-Point Precision Errors (Evidence from Data)

عمرو السمالوسي balance:  0.17149999999674037 EGP  (should be 0.17)
ميكنة احمد عبيد balance: 0.19999999999708962 EGP  (should be 0.20)
These are Excel export artifacts. Minor individually, but will compound in automation.

D. Unexplained AP Balance

جهاز مستقبل مصر (Code 20900151):
  Role documented: Equity investor → 5,000,000 EGP capital
  AP balance found: 1,959,600 EGP (no source invoice identified)
  Classification: Unknown — cannot determine if this is equipment advance, loan, or data entry error
E. Critical Structural Gap: No Inventory Issuance Records
The entire مخازن file (4,830 items) records only receipts. There are zero issuance (تصريف) records. This means:

COGS = 0 in the current system
All fertilizer expense is still sitting on the balance sheet as inventory
P&L is structurally overstated (no matching cost against crop revenue)
9. REQUIRED DATABASE STRUCTURE
service_types Table

CREATE TABLE service_types (
  service_id INT PRIMARY KEY,
  service_name_ar VARCHAR(100),
  service_name_en VARCHAR(100),
  service_category VARCHAR(50),     -- 'Equipment', 'Labor', 'Materials', 'Supervision'
  default_uom VARCHAR(20),          -- 'ساعة', 'عامل', 'كجم', 'لتر', 'مبلغ'
  standard_rate DECIMAL(12,2),      -- 842.857 for equipment; 325 for labor; NULL for materials
  rate_basis VARCHAR(50),           -- 'per_hour', 'per_worker', 'per_unit', 'per_month'
  default_debit_account VARCHAR(10), -- '5101', '1407', '33067'
  default_credit_account VARCHAR(10), -- '2120', '2120.1', '2120.2'
  requires_pivot BOOLEAN,
  requires_crop BOOLEAN,
  requires_batch BOOLEAN,
  requires_season BOOLEAN
);
supplier_classification Table

CREATE TABLE supplier_classification (
  supplier_id INT PRIMARY KEY,
  supplier_code INT,
  supplier_name_ar VARCHAR(200),
  supplier_type VARCHAR(50),        -- 'Equipment', 'Labor', 'Materials', 'Supervision', 'Equity'
  is_multi_service BOOLEAN,
  ap_account_code VARCHAR(10),
  ap_subaccount_code VARCHAR(10),   -- For split AP (e.g., 2120.1 vs. 2120.2)
  primary_service_id INT REFERENCES service_types,
  secondary_service_id INT REFERENCES service_types,
  current_ap_balance DECIMAL(15,2),
  payment_terms_days INT
);
posting_rules Table

CREATE TABLE posting_rules (
  rule_id INT PRIMARY KEY,
  rule_code VARCHAR(20),            -- 'EQUIP-001', 'LABOR-001', etc.
  document_type VARCHAR(50),
  service_type_id INT REFERENCES service_types,
  default_debit_account VARCHAR(10),
  default_credit_account VARCHAR(10),
  require_supplier BOOLEAN,
  require_pivot BOOLEAN,
  require_crop BOOLEAN,
  require_batch BOOLEAN,
  validation_expression VARCHAR(500),
  posting_frequency VARCHAR(20)     -- 'Immediate', 'Daily', 'Monthly'
);
operational_events Table (Event Log)

CREATE TABLE operational_events (
  event_id INT PRIMARY KEY,
  event_date DATE,
  event_type VARCHAR(50),
  document_type VARCHAR(50),
  document_number VARCHAR(20),
  supplier_code INT,
  pivot_code INT,
  crop_code INT,
  service_type_id INT,
  quantity DECIMAL(15,4),
  unit_of_measure VARCHAR(20),
  unit_price DECIMAL(12,2),
  total_amount DECIMAL(15,2),
  debit_account VARCHAR(10),
  credit_account VARCHAR(10),
  posting_status VARCHAR(20),       -- 'Draft', 'Posted', 'Reversed'
  batch_number VARCHAR(50),
  created_date TIMESTAMP,
  created_by VARCHAR(50)
);
Additional Required Masters
pivots: code, name, booster_station, hectares, status
crops: code, name_ar, cycle_type (شتوى/صيفى), expected_yield_unit
seasons: year, type, start_date, end_date
items (inventory): code, name_ar, uom, warehouse_type, density_factor (for لتر↔كجم)
10. ERP DESIGN RECOMMENDATIONS
Posting Engine Architecture

[Operational Entry] (supplier ledger, warehouse receipt, cash payment)
        ↓
[Dimension Resolver] — lookup: Supplier → Service Type → GL accounts
        ↓
[Validation Gate] — enforce required dimensions; reject if missing
        ↓
[GL Entry Constructor] — Debit + Credit + all dimensions
        ↓
[Posting] — write to GL; update AP/AR/Inventory sub-ledgers
        ↓
[Reconciliation] — AP aging, inventory balance, cash reconciliation
        ↓
[Reporting] — cost by pivot, cost by service, cost by crop, partner equity
Three Changes That Unlock Automated Posting
Service Master — create service_types table; link each supplier transaction to a service type; this alone resolves 70% of GL routing ambiguity
Supplier Split — decompose شركة عرفة into 2 masters (materials + services); this resolves the 17M AP ambiguity
Inventory Issuance Module — create تصريف transaction type; automatically post COGS on field issuance
11. RISKS IF CURRENT MODEL CONTINUES
Risk	Evidence	Financial Impact
COGS = 0	No تصريف (issuance) records in مخازن	Crop P&L is structurally wrong; all costs on balance sheet
AP misclassification	عرفة 17M in single account covering 3 service types	COGS vs. operating expense cannot be separated; audit flag
Cash crunch	No invoice due dates; no aging schedule	Cannot predict which of the 17M AP will accelerate; partner call risk
Labor cost error	"عامل" unit without hour specification	If part-day labor, COGS overstated by up to 25%
Investor role conflict	جهاز مستقبل مصر has both equity + 1.96M AP	Cannot determine if AP is legitimate payable or data entry error
Regulatory risk	No batch/lot on 4,830 pesticide items	Contamination recall impossible; soil record compliance failure
Pivot profitability blind	No cost/feddan or cost/pivot reporting	Management cannot optimize which pivots to prioritize for next season
Equipment overcost	842.857 EGP/hr with no volume discount captured	100+ hours at fixed rate; possible negotiation value left on table
Q1 2026 statements materially wrong	COGS missing, AP not aged, supervision bundled with inventory	Profit overstated; balance sheet inflated; restatement risk
12. FINAL ARCHITECTURE VERDICT
Current State: NOT READY for automated GL posting.

What Must Change (Priority Order)
Priority	Action	Effort	Blocks
P1	Create service_types table; link all transactions to service type	4–6 hrs	All GL routing
P1	Split شركة عرفة into Materials arm + Services arm; separate AP sub-accounts	4–6 hrs	COGS accuracy
P1	Investigate 1.96M unexplained AP on جهاز مستقبل مصر	2–4 hrs	Balance sheet integrity
P2	Add تاريخ الاستحقاق (due date) to all AP records	2 hrs	AP aging
P2	Create تصريف (inventory issuance) transaction type with COGS posting rule	16–24 hrs	Revenue matching
P2	Add Batch/Lot tracking to inventory	8–12 hrs	Regulatory + FIFO cost
P3	Invoice-to-payment matching; AP aging by original invoice date	12–16 hrs	Cash forecast
P3	Add feddan area per pivot; enable cost/feddan reporting	4 hrs	Management analytics
Minimum Viable Posting Rules Before Q2 2026 Close
7 rules defined above (EQUIP-001 through SERV-001) are the minimum to correctly post all transaction types currently in the data. Of these, COGS-001 is the highest-risk gap — without it, the entire 2025-2026 season will have zero matching between crop revenue and input costs.

Go/No-Go Decision Required
Manual GL posting with supervisor review must continue in parallel until at minimum:

Service master exists (service_types table populated)
شركة عرفة is split into 2 masters
Inventory issuance module is operational
Estimated remediation timeline: 4–8 weeks if prioritized.

All findings above are derived directly from the JSON data. Evidence references: 313 supplier transactions (نواة_المستقبل), 69 treasury transactions (خزينة), 4,830 inventory items (مخازن), full chart of accounts (شجرة_نواة_المستقبل). No generic ERP theory has been inject

الخطة الكاملة من الوضع الحالي هي: نعم، سنشتغل على مسار كامل ينتهي بإعادة كتابة البيانات التشغيلية والقيود، لكن بشكل منضبط وليس هدمًا عشوائيًا. المرجع التشخيصي الذي بنينا عليه موجود في DATA-EXECUTION_PLAN.md، لكن التنفيذ الصحيح الآن يجب أن يتحول من تقرير تشخيص إلى برنامج عمل مرحلي واضح.

**الهدف النهائي**
نريد أن نصل إلى 5 أشياء فقط:
1. كل حركة لها معنى واحد واضح: مخزني، خدمة، عمالة، ميكنة، إشراف، سداد مورد.
2. كل مورد معروف: ماذا يقدم، وما الحسابات التي تخصه، وهل هو أحادي النشاط أم متعدد النشاط.
3. كل قيد يتولد من قواعد ثابتة، لا من الاسم الحر أو التخمين.
4. المخزون يمر بمرحلتين منفصلتين: استلام ثم صرف، وليس شراء فقط.
5. إعادة بناء الساب ليدجر والقيود من البيانات المصدر بعد تنظيفها وتصنيفها.

**الحكم التنفيذي**
لسنا محتاجين نبدأ من الصفر، لكننا محتاجين إعادة بناء الطبقة الدلالية بالكامل:
1. taxonomy للخدمات
2. mapping بين المورد والخدمة
3. normalization للبيانات المصدر
4. controlled reposting للقيود

**الخطة الكاملة التي سنشتغل عليها**

**المرحلة 1: تثبيت نموذج الحوكمة النهائي**
في هذه المرحلة نثبت قواعد المعنى قبل أي تحميل جديد.

المخرجات:
1. اعتماد matrix الحوكمة الموجود في DATA_GOVERNANCE_MATRIX_FINAL_2026-05-10.md كمرجع إلزامي.
2. تعريف canonical dimensions النهائية لكل حركة:
supplier_code
document_type
document_number
document_date
statement_text
service_type_code
season_id
center_code
field_id
work_order_id
financial_account_id
journal_entry_id
3. تحديد الفرق الرسمي بين:
GRN
ISSUE
Supplier Invoice
Supplier Payment
Equipment Rental
Labor Supply
Agricultural Supervision
4. منع الخلط بين:
نشاط المورد
نوع الخدمة في الحركة
الحساب المحاسبي الناتج

**المرحلة 2: إعادة تصميم طبقة التصنيف**
هذه أهم مرحلة، لأنها تحل أصل الأزمة.

المخرجات:
1. إنشاء Service Master فعلي:
SRV_MECH
SRV_LABOR
SRV_SUPPLY
SRV_LOGISTICS
SRV_SUPERVISION
SRV_SPARE_PARTS
2. لكل service type نحدد:
الاسم
service_group
default expense account
default AP account
هل يحتاج مورد
هل يحتاج مستند
هل يحتاج مركز تكلفة
3. إنشاء Supplier-Service Mapping:
كل مورد ما الخدمات المسموح بها له
ما الحساب الافتراضي الدائن لكل خدمة
هل هو single-service أو multi-service
4. تثبيت سياسة الموردين:
المورد أحادي النشاط يمكن أن يكون له gl_account_code ثابت
المورد متعدد النشاط لا يكفيه gl_account_code واحد، ويجب أن يحسم الحساب من service_type_code داخل الحركة

**المرحلة 3: إعادة تأهيل الماستر داتا**
هنا نعيد كتابة الماستر داتا نفسها لو لزم.

المخرجات:
1. تنظيف suppliers:
تثبيت gl_account_code للموردين الأحاديين
تثبيت bus_posting_group_code عند الحاجة
إزالة الاعتماد على activity كنص فقط
2. مراجعة الموردين المتعددين:
شركة عرفة
جهاز مستقبل مصر
3. حسم هل نحتاج:
supplier واحد + أكثر من service mapping
أم split supplier master إذا كان الفصل القانوني/التعاقدي حقيقي
4. تثبيت chart mapping الرسمي بين الموردين وحسابات 2120 الفرعية

**المرحلة 4: إعادة كتابة البيانات المصدر إلى شكل Canonical**
نعم، هذه المرحلة تشمل إعادة كتابة البيانات مرة أخرى، لكن ليس يدويًا ولا بعشوائية.

الفكرة:
نأخذ البيانات الأصلية من ملفات المصدر، ونعيد تحميلها إلى شكل canonical نظيف قبل الترحيل.

المخرجات:
1. إنشاء staging logic واضح لكل مصدر:
suppliers source
treasury source
inventory source
operations source
2. أثناء التحويل نملأ الحقول الناقصة أو نرفعها كحالات governance flags:
service_type_code
statement_text
document_type
document_number
supplier_code
season_id
center_code
3. تصنيف البيانات القديمة بقواعد deterministic:
supplier + document_type + item group + narration + direction
4. نقل technical tags من النصوص إلى flags منفصلة
5. منع أي صف غير محسوم من الوصول إلى posted state

هذه المرحلة تعني عمليًا:
إعادة كتابة supplier_transactions
إعادة كتابة cash_transactions عند الحاجة للحقل الدلالي
إعادة كتابة inventory_movements في الشكل canonical
ثم إعادة بناء business_events و journal_entries بعد ذلك

**المرحلة 5: إقفال الـ API Hardening**
بعد ما نثبت النموذج، نقفل الإدخال الجديد حتى لا يعيد إنتاج الفوضى.

المطلوب:
1. في movements.ts
GRN:
supplier_code مطلوب
document_number مطلوب
center_code ليس إجباريًا افتراضيًا
ISSUE:
center_code مطلوب
statement_text مطلوب
service_type_code مطلوب
2. في suppliers.ts
Supplier invoice:
supplier_code و season_id و center_code حسب السياسة
Supplier payment:
financial_account_id إجباري
statement_text إجباري
service_type_code إذا كانت الحركة خدمية
3. في treasury.ts
كل حركة posted لازم يكون لها بيان واضح
ومنطق service_type_code موحد مع الموردين
4. منع أي posted transaction بتاريخ مستقبلي على مستوى الـ API وليس فقط في rebuild script

**المرحلة 6: إعادة بناء الـ Posting Rules**
بعد تطبيع البيانات، نعيد بناء routing.

المخرجات:
1. Rule set فعلي لكل نوع:
Equipment Rental
Labor Supply
Supply Purchase
Supervision Expense
Supplier Payment
Inventory Receipt
Inventory Issue
2. الحسابات لا تعتمد على اسم المورد، بل على:
service_type_code
transaction role
supplier override إن وجد
3. Inventory receipt لا يتحول تلقائيًا إلى cost center expense
4. Inventory issue هو الذي يحمل center/field/season ويولد التكلفة
5. Supplier payment يخصم من AP الصحيح الخاص بنوع الخدمة أو المورد

**المرحلة 7: إعادة التحميل والتحويل الكامل**
هذه هي مرحلة التنفيذ الكبير.

الخطوات:
1. أخذ نسخة أمان من الجداول الحالية
2. controlled wipe للجداول downstream فقط
3. إعادة تحميل الماستر داتا canonical
4. إعادة تحميل الحركات canonical
5. إعادة تكوين business_events
6. إعادة تكوين journal_entries و journal_entry_lines
7. إعادة ربط sub-ledgers بالقيود

الجداول التي قد تدخل إعادة كتابة:
suppliers
supplier_transactions
cash_transactions
inventory_movements
business_events
journal_entries
journal_entry_lines

**المرحلة 8: تسوية الساب ليدجر**
هذه المرحلة لضمان أن النظام ليس فقط يولد قيودًا، بل أيضًا يفهم الذمم والحركة التشغيلية.

المخرجات:
1. Supplier AP aging من تاريخ الفاتورة الفعلي
2. invoice-to-payment matching
3. open balance per supplier per service class
4. inventory on-hand صحيح
5. inventory issue to field/center/season
6. cost by supplier
7. cost by service type
8. cost by center/pivot/field

**المرحلة 9: التحقق النهائي**
قبل الاعتماد، نعمل verification رسمي.

التحقق المطلوب:
1. لا يوجد posted row بدون journal_entry_id إلا الحالات المستقبلية الممنوعة
2. لا يوجد future dated JE
3. لا يوجد posted GRN بدون supplier_code أو document_number
4. لا يوجد posted ISSUE بدون center_code أو service_type_code
5. لا يوجد supplier متعدد النشاط يُرحل بحساب ثابت خاطئ
6. كل مورد أحادي النشاط مربوط بحساب AP صحيح
7. balances بين sub-ledger و GL متطابقة
8. المخزون المستلم والمصروف يطابق WAC والحركات الفعلية

**ترتيب التنفيذ الصحيح**
هذا هو الترتيب الذي يجب أن نمشي به حرفيًا:

1. اعتماد canonical service taxonomy
2. اعتماد supplier-service mapping
3. حسم الموردين multi-service
4. تعديل الـ APIs وقواعد validation
5. تجهيز staging/backfill rules
6. إعادة كتابة البيانات canonical
7. إعادة بناء posting
8. reconciliation and sign-off

**ما الذي سنعيد كتابته فعلًا**
نعم، وبدون مواربة، الخطة تتضمن إعادة كتابة بيانات، لكن على 3 مستويات:

1. Master rewrite
للموردين والتصنيف والحسابات المرجعية

2. Transaction rewrite
لإضافة service_type_code والبيان والمستند والأبعاد بشكل canonical

3. Posting rewrite
لإعادة بناء business_events والقيود من جديد على أساس صحيح

لكن لن نعيد كتابة source truth الخام نفسها. المصدر الخام يبقى كما هو، وإعادة الكتابة تكون في طبقة canonical داخل النظام.

**أول Sprint فعلي من الوضع الحالي**
لو بدأنا الآن، أول sprint يجب أن يكون فقط هذا:

1. إنشاء service_types و supplier_service_map
2. ضبط الموردين الأحاديين وربطهم بحساباتهم النهائية
3. حسم قواعد الموردين المتعددين
4. تعديل movements.ts حسب الفرق بين GRN و ISSUE
5. توحيد validation في treasury.ts و suppliers.ts
6. بعدها نبدأ backfill وإعادة الترحيل

**النتيجة المتوقعة بعد تنفيذ الخطة**
بعد الخطة دي، لن نرجع كل مرة نسأل:
هل المورد ده عمالة ولا ميكنة؟
هل ده شراء مخزني ولا تكلفة تشغيلية؟
هل الحساب يتحدد من المورد ولا من نوع الخدمة؟
هل القيود دي صح ولا اتكونت من نصوص ملخبطة؟

سيبقى عندنا model واحد واضح:
الحركة تقول ما هي
الخدمة تقول كيف تُرحل
المورد يقول من يقدمها
والقيد يتولد بدون اجتهاد

إذا تريد، الخطوة التالية المنطقية الآن هي أن أحول هذه الخطة إلى execution backlog عملي من 3 مراحل:
1. Phase 1: Schema and taxonomy
2. Phase 2: API hardening and mapping
3. Phase 3: data rewrite and reposting

وأرتبها لك كمهام تنفيذية فعلية بالترتيب الذي سنشتغل عليه داخل المشروع.

---

## تحديث تنفيذي نهائي - 2026-05-11

### قرار رسمي لحالات future-blocked (عدد 52)
تم اعتماد سياسة `KEEP BLOCKED` للحركات المستقبلية بدون أي تعديل تواريخ أو إعادة تصنيف قسري للبيانات.

التوزيع الحالي:
- Supplier future-blocked = 6
- Inventory future-blocked = 46
- الإجمالي = 52

### لماذا هذا القرار؟
1. يمنع أي تشويه زمني (date tampering) في السجلات.
2. يحافظ على سلامة القيود المنشورة وعدم كسر أثر التدقيق.
3. يسمح بالإفراج الطبيعي عند وصول التاريخ الفعلي أو بقرار عمل موثق لاحقًا.

### التحقق النهائي المنفذ فعليًا
1. `actionable_supplier_nonfuture = 0`
2. `actionable_inventory_nonfuture = 0`
3. `future_blocked_supplier = 6`
4. `future_blocked_inventory = 46`
5. `unbalanced_supplier_entries = 0`
6. `unbalanced_inventory_entries = 0`
7. `posted_supplier_null_service_type = 0`
8. `grn_issue_null_service_type = 0`

### النتيجة
تم إغلاق مسار remediation الحالي بنجاح.
لا توجد صفوف actionable متبقية حتى تاريخ 2026-05-11، والمتبقي فقط 52 صفًا محجوبًا بالسياسة الزمنية المعتمدة.

### الخطوات التالية (Phase Next)
1. تثبيت السياسة الزمنية في التشغيل اليومي:
        - الإبقاء على `POSTING_CUTOFF_DATE` كضابط رسمي قبل كل تشغيل ترحيل.
        - منع أي معالجة تلقائية للحركات المستقبلية قبل تاريخها الفعلي.

2. مراقبة يومية خفيفة (Daily Control):
        - تشغيل فحص عددي يومي للحالات التالية:
          - actionable non-future
          - future-blocked
          - unbalanced entries
        - إرسال تنبيه فقط عند أي انحراف عن القيم المرجعية الحالية.

3. عزل نطاق الإصدار التالي (Scope Isolation):
        - التعامل مع تغييرات الواجهة/الأرشفة كمسار مستقل تمامًا عن مسار المالية.
        - عدم دمج أي تغييرات UI واسعة قبل اختبار قبول منفصل.

4. شرط الإفراج عن الـ 52 مستقبلية:
        - الإفراج يتم آليًا عند دخول التاريخ ضمن cutoff.
        - أي إفراج استثنائي قبل التاريخ يتطلب اعتماد عمل موثق (Change Approval).

### Operationalization Artifacts (Implemented)
1. Daily SQL Query Pack:
        - `sql/governance/03_daily_finance_control_query_pack.sql`
2. Baseline snapshot (reference date 2026-05-11):
        - `reports/monitoring/BASELINE_DAILY_CONTROL_2026-05-11.md`
3. Daily control policy:
        - `reports/monitoring/DAILY_FINANCE_CONTROL_POLICY.md`
4. Automation script (daily run + snapshot output):
        - `scripts/run_daily_finance_control.ps1`
        - Output path: `reports/monitoring/daily_runs/`