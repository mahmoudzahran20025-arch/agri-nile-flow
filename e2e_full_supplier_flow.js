/**
 * E2E: إنشاء مورد جديد + إضافة قيود + التحقق من الكشف والقيود
 * ──────────────────────────────────────────────────────────────
 * يغطي:
 *   1) Login
 *   2) إنشاء مورد جديد
 *   3) إضافة فاتورة مشتريات (مرحّل)
 *   4) إضافة دفعة سداد (مرحّل)
 *   5) إضافة قيد مسودة
 *   6) ترحيل المسودة + التحقق من Mirror في الخزينة
 *   7) عرض كشف المورد النهائي
 *   8) فحص GL Orphans بعد العمليات
 */

const BASE = process.env.API_BASE || 'https://agri-nile-flow.mahm-zahran22.workers.dev/api'
const EMAIL    = process.env.AUTH_EMAIL    || 'admin@nawa.eg'
const PASSWORD = process.env.AUTH_PASSWORD || 'Admin@2025'
const COMPANY  = Number(process.env.AUTH_COMPANY_ID || '1')

// ─── helpers ─────────────────────────────────────────────────
const sep = () => console.log('─'.repeat(65))

function egp(n) {
  return Number(n || 0).toLocaleString('ar-EG', { style: 'currency', currency: 'EGP', minimumFractionDigits: 2 })
}

function ymd(d) { return d.toISOString().slice(0, 10) }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d) }
const today = ymd(new Date())

async function req(path, opts = {}, token = null) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  const res = await fetch(`${BASE}${path}`, { ...opts, headers })
  let data
  try { data = await res.json() } catch { data = { success: false, error: 'non-JSON' } }
  return { res, data }
}

function ok(label, cond, extra = '') {
  const mark = cond ? '✅' : '❌'
  console.log(`${mark} ${label}${extra ? '  →  ' + extra : ''}`)
  return cond
}

function section(title) { sep(); console.log(`\n  📌  ${title}\n`) }

// ─── main ─────────────────────────────────────────────────────
async function run() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗')
  console.log('║           E2E — مورد جديد + قيود + GL                       ║')
  console.log(`╚══════════════════════════════════════════════════════════════╝`)
  console.log(`  Base : ${BASE}`)
  console.log(`  Date : ${today}\n`)

  // ── 1. Login ────────────────────────────────────────────────
  section('1. تسجيل الدخول')
  const { res: lr, data: ld } = await req('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, company_id: COMPANY }),
  })
  if (!ok('Login', lr.ok && ld?.data?.token, `status=${lr.status}`)) {
    console.error('  تفاصيل:', JSON.stringify(ld)); process.exit(1)
  }
  const token = ld.data.token
  console.log(`  المستخدم : ${ld.data.user?.full_name}`)
  console.log(`  الصلاحيات: ${ld.data.permissions?.length} إذن`)

  // ── 2. جلب season + cost_center ──────────────────────────────
  section('2. جلب إعدادات الموسم ومركز التكلفة')
  const [{ data: seasonsD }, { data: ccD }] = await Promise.all([
    req('/config/seasons', {}, token),
    req('/config/cost_centers', {}, token),
  ])

  const seasons = seasonsD?.data || []
  const centers = ccD?.data || []
  const activeSeason = seasons.find(s => String(s.status || '').toLowerCase() === 'active') || seasons[0]
  const firstCenter  = centers[0]

  ok('Seasons loaded',  seasons.length > 0,  `count=${seasons.length}`)
  ok('Centers loaded',  centers.length > 0,  `count=${centers.length}`)

  if (!activeSeason || !firstCenter) {
    console.error('  ❌ لا يوجد موسم أو مركز تكلفة — تأكد من الإعدادات')
    process.exit(1)
  }
  const seasonId   = Number(activeSeason.id)
  const centerCode = Number(String(firstCenter.code))
  console.log(`  الموسم     : ${activeSeason.name} (id=${seasonId})`)
  console.log(`  مركز التكلفة: ${firstCenter.name_ar || firstCenter.name} (code=${centerCode})`)

  // ── 3. إنشاء مورد جديد ──────────────────────────────────────
  section('3. إنشاء المورد الجديد')
  const runId      = Date.now()
  // كود رقمي فريد من 9 أرقام (يبدأ بـ 99 لتجنب التعارض مع الموردين الحاليين)
  const supplierCode = 99000000 + (runId % 900000)

  const { res: sr, data: sd } = await req('/suppliers', {
    method: 'POST',
    body: JSON.stringify({
      code:           supplierCode,
      name:           `مورد اختبار E2E ${new Date().toLocaleDateString('ar-EG')}`,
      phone:          '010-000-E2E',
      activity:       'مورد تجريبي للإدخال والاختبار',
      payment_terms:  30,
      supplier_type:  'supplier',
    }),
  }, token)

  ok('Supplier created', sr.ok && sd?.success, `status=${sr.status}`)
  if (!sd?.success) {
    console.log('  التفاصيل:', JSON.stringify(sd))
    // محاولة جلب الكود إذا كان موجوداً بالفعل
    const { data: listD } = await req(`/suppliers?q=${encodeURIComponent('E2E')}&limit=5`, {}, token)
    const existing = (listD?.data || []).find(s => String(s.code).includes('E2E'))
    if (existing) {
      console.log(`  ℹ️  وُجد مورد سابق: code=${existing.code}`)
    } else {
      process.exit(1)
    }
  }

  // ── الكود هو رقمي وتم إرساله منا ─────────────────────────
  if (!sd?.success) {
    console.error('  ❌ فشل إنشاء المورد:', JSON.stringify(sd))
    process.exit(1)
  }
  const suppCode = supplierCode   // رقمي
  const suppName = `مورد اختبار E2E ${new Date().toLocaleDateString('ar-EG')}`
  console.log(`\n  ✔  تم إنشاء المورد: [${suppCode}] ${suppName}`)

  // ── 4. إضافة فاتورة مشتريات (مرحّل) ─────────────────────────
  section('4. فاتورة مشتريات — مرحّل')
  const invoice = {
    transaction_date: daysAgo(5),
    entry_type:       'د',            // دائن = عليه مستحق
    amount:           50000,
    document_type:    'فاتورة',
    document_number:  runId,
    expense_category: 'بذور ومستلزمات',
    unit:             'طن',
    quantity:         10,
    unit_price:       5000,
    notes:            `E2E_INV:${runId}`,
    season_id:        seasonId,
    center_code:      centerCode,
    status:           'posted',
  }

  const { res: inv_r, data: inv_d } = await req(`/suppliers/${suppCode}/transactions`, {
    method: 'POST',
    body: JSON.stringify(invoice),
  }, token)

  const invOk = inv_r.ok && inv_d?.success
  ok('Invoice created (posted)', invOk, `status=${inv_r.status}  id=${inv_d?.data?.id ?? '—'}  GL=${inv_d?.data?.journal_entry_id ?? '—'}`)
  if (!invOk) console.log('  تفاصيل الخطأ:', JSON.stringify(inv_d))
  const invId = inv_d?.data?.id

  // ── 5. إضافة دفعة سداد جزئي (مرحّل) ─────────────────────────
  section('5. دفعة سداد جزئي — مرحّل')
  const payment = {
    transaction_date: daysAgo(2),
    entry_type:       'م',            // مدين = دفع
    amount:           20000,
    document_type:    'نقداً',
    expense_category: 'سداد فاتورة بذور',
    notes:            `E2E_PAY:${runId}`,
    season_id:        seasonId,
    center_code:      centerCode,
    status:           'posted',
  }

  const { res: pay_r, data: pay_d } = await req(`/suppliers/${suppCode}/transactions`, {
    method: 'POST',
    body: JSON.stringify(payment),
  }, token)

  const payOk = pay_r.ok && pay_d?.success
  ok('Payment created (posted)', payOk, `status=${pay_r.status}  id=${pay_d?.data?.id ?? '—'}`)
  if (!payOk) console.log('  تفاصيل الخطأ:', JSON.stringify(pay_d))

  // ── 6. إضافة قيد مسودة ───────────────────────────────────────
  section('6. قيد مسودة + ترحيل')
  const draftTxn = {
    transaction_date: today,
    entry_type:       'م',
    amount:           5000,
    document_type:    'شيك',
    expense_category: 'دفعة بالشيك',
    notes:            `E2E_DRAFT:${runId}`,
    season_id:        seasonId,
    center_code:      centerCode,
    status:           'draft',
  }

  const { res: dr_r, data: dr_d } = await req(`/suppliers/${suppCode}/transactions`, {
    method: 'POST',
    body: JSON.stringify(draftTxn),
  }, token)

  const draftOk = dr_r.ok && dr_d?.success
  ok('Draft created', draftOk, `status=${dr_r.status}  id=${dr_d?.data?.id ?? '—'}`)
  if (!draftOk) console.log('  تفاصيل الخطأ:', JSON.stringify(dr_d))

  const draftId = dr_d?.data?.id

  // ترحيل المسودة
  if (draftId) {
    const { res: post_r, data: post_d } = await req(`/suppliers/${suppCode}/transactions/${draftId}/post`, {
      method: 'PATCH',
      body: JSON.stringify({}),
    }, token)
    const postOk = post_r.ok && post_d?.success
    ok('Draft → Posted', postOk, `status=${post_r.status}  GL=${post_d?.data?.journal_entry_id ?? '—'}`)
    if (!postOk) console.log('  تفاصيل الخطأ:', JSON.stringify(post_d))
  }

  // ── 7. كشف حساب المورد ───────────────────────────────────────
  section('7. كشف حساب المورد')
  const { res: st_r, data: st_d } = await req(
    `/suppliers/${suppCode}/statement?page=1&size=50`, {}, token
  )
  ok('Statement loaded', st_r.ok && st_d?.success, `status=${st_r.status}`)

  if (st_d?.data?.length) {
    console.log('\n  ┌──────────────────────────────────────────────────────────────')
    console.log('  │  التاريخ     │ النوع │ الوصف                   │ المبلغ       │ الرصيد        │ حالة  │ قيد')
    console.log('  ├──────────────────────────────────────────────────────────────')
    for (const r of st_d.data) {
      const date   = (r.transaction_date || '').slice(0, 10)
      const type   = r.entry_type === 'د' ? '📥 فاتورة' : '💸 دفعة '
      const desc   = (r.expense_category || r.document_type || '').substring(0, 20).padEnd(22)
      const amount = String(egp(r.amount)).padStart(14)
      const bal    = String(egp(r.balance_no_checks)).padStart(14)
      const status = r.status === 'posted' ? '✅ مرحّل' : '📝 مسودة'
      const gl     = r.journal_entry_id ? `#${r.journal_entry_id}` : '—'
      console.log(`  │  ${date}  │ ${type}│ ${desc}│${amount} │${bal}  │ ${status} │ ${gl}`)
    }
    console.log('  └──────────────────────────────────────────────────────────────')

    const summary = st_d.summary || {}
    console.log(`\n  الرصيد المفتوح  : ${egp(summary.open_balance ?? st_d.data[0]?.balance_no_checks)}`)
    console.log(`  إجمالي الفواتير : ${egp(summary.total_invoiced)}`)
    console.log(`  إجمالي المدفوع  : ${egp(summary.total_paid)}`)
  } else {
    console.log('  (لا توجد حركات بعد — قد تحتاج دقيقة للانتشار)')
  }

  // ── 8. فحص توافق AP مع GL ────────────────────────────────────
  section('8. فحص GL Orphans')
  const { res: gl_r, data: gl_d } = await req('/gl/orphans?limit=5', {}, token)
  ok('GL Orphans check', gl_r.ok && gl_d?.success, `status=${gl_r.status}`)
  if (gl_d?.data?.length > 0) {
    console.log('  ⚠️  يوجد قيود غير متوازنة:')
    gl_d.data.forEach(e => console.log(`    - Entry #${e.id}: debit=${e.debit_total} credit=${e.credit_total}`))
  } else {
    console.log('  ✅ لا توجد قيود غير متوازنة — GL نظيف')
  }

  // ── 9. فحص الخزينة (payment mirror) ─────────────────────────
  section('9. تحقق من mirror الدفعات في الخزينة')
  const { res: sp_r, data: sp_d } = await req(
    `/treasury/supplier-payments?supplier_code=${suppCode}&size=20`, {}, token
  )
  if (sp_r.ok && sp_d?.success) {
    const rows = sp_d.data || []
    ok('Treasury mirror', rows.length > 0, `صفوف الدفعات=${rows.length}`)
    if (rows.length) {
      console.log('  ┌──────────────────────────────────────────')
      rows.slice(0, 5).forEach(r => {
        console.log(`  │  ${r.transaction_date?.slice(0,10)}  ${egp(r.amount).padStart(16)}  ${r.narration?.substring(0,30) || '—'}`)
      })
      console.log('  └──────────────────────────────────────────')
    }
  } else {
    // Endpoint قد لا يوجد بهذا المسار
    ok('Treasury mirror endpoint', false, `status=${sp_r.status} — ${sp_d?.error || 'N/A'}`)
  }

  // ─── ملخص نهائي ──────────────────────────────────────────────
  sep()
  console.log(`\n  🎯  ملخص E2E — المورد [${suppCode}] ${suppName}`)
  console.log(`\n  الخطوات المنفّذة:`)
  console.log(`    1. تسجيل دخول ✅`)
  console.log(`    2. إنشاء مورد جديد ✅`)
  console.log(`    3. فاتورة مشتريات بـ ${egp(50000)} (مرحّلة)`)
  console.log(`    4. دفعة سداد بـ ${egp(20000)} (مرحّلة)`)
  console.log(`    5. مسودة شيك بـ ${egp(5000)} → تم ترحيلها`)
  console.log(`    6. كشف حساب نهائي`)
  console.log(`    7. فحص GL Orphans`)
  console.log(`    8. فحص mirror الخزينة`)
  console.log(`\n  💡  لعرض المورد في الواجهة:`);
  console.log(`      https://feature-posting-engine-v2.agri-nile-flow-lake.pages.dev/suppliers/${suppCode}`)
  sep()
}

run().catch(err => {
  console.error('\n❌ RUN_ERR:', err.message)
  process.exit(1)
})
