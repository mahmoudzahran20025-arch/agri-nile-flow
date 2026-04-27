/**
 * Script 1: إعداد Posting Groups
 * 
 * هذا السكريبت يُنشئ:
 * - Business Posting Groups
 * - Product Posting Groups  
 * - Inventory Posting Groups
 * - General Posting Setup
 * - Inventory Posting Setup
 */

const API_BASE = process.env.API_BASE || 'http://localhost:8787';

// ═══════════════════════════════════════════════════════════════════════════
// 1. Business Posting Groups
// ═══════════════════════════════════════════════════════════════════════════
const businessPostingGroups = [
  {
    code: 'DOMESTIC',
    name: 'موردين محليين',
    description: 'موردين وعملاء محليين داخل مصر',
  },
  {
    code: 'EXPORT',
    name: 'عملاء تصدير',
    description: 'عملاء خارج مصر (تصدير)',
  },
  {
    code: 'INTERNAL',
    name: 'عمليات داخلية',
    description: 'تحويلات بين المخازن والفروع',
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// 2. Product Posting Groups
// ═══════════════════════════════════════════════════════════════════════════
const productPostingGroups = [
  {
    code: 'FERT',
    name: 'أسمدة',
    description: 'جميع أنواع الأسمدة (عضوية، كيماوية، سائلة)',
  },
  {
    code: 'SEED',
    name: 'بذور',
    description: 'بذور وتقاوي',
  },
  {
    code: 'CHEM',
    name: 'مبيدات',
    description: 'مبيدات حشرية وفطرية وعشبية',
  },
  {
    code: 'EQUIP',
    name: 'معدات',
    description: 'معدات زراعية وآلات',
  },
  {
    code: 'SERVICE',
    name: 'خدمات',
    description: 'خدمات إدارية واستشارية',
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// 3. Inventory Posting Groups
// ═══════════════════════════════════════════════════════════════════════════
const inventoryPostingGroups = [
  {
    code: 'FERT-WH',
    name: 'مخزن أسمدة',
    description: 'المخزن الرئيسي للأسمدة',
  },
  {
    code: 'SEED-WH',
    name: 'مخزن بذور',
    description: 'المخزن الرئيسي للبذور',
  },
  {
    code: 'CHEM-WH',
    name: 'مخزن مبيدات',
    description: 'المخزن الرئيسي للمبيدات',
  },
  {
    code: 'MAIN-WH',
    name: 'المخزن الرئيسي',
    description: 'المخزن الرئيسي العام',
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// 4. General Posting Setup (Business × Product)
// ═══════════════════════════════════════════════════════════════════════════
const generalPostingSetup = [
  // DOMESTIC × FERT
  {
    bus_posting_group_code: 'DOMESTIC',
    prod_posting_group_code: 'FERT',
    sales_account: '4001',           // إيرادات مبيعات أسمدة
    purchases_account: '5001',       // مشتريات أسمدة
    cogs_account: '5101',            // تكلفة البضاعة المباعة - أسمدة
    sales_returns_account: '4101',   // مردودات مبيعات
    purch_returns_account: '5201',   // مردودات مشتريات
    is_active: 1,
  },
  // DOMESTIC × SEED
  {
    bus_posting_group_code: 'DOMESTIC',
    prod_posting_group_code: 'SEED',
    sales_account: '4002',
    purchases_account: '5002',
    cogs_account: '5102',
    sales_returns_account: '4102',
    purch_returns_account: '5202',
    is_active: 1,
  },
  // DOMESTIC × CHEM
  {
    bus_posting_group_code: 'DOMESTIC',
    prod_posting_group_code: 'CHEM',
    sales_account: '4003',
    purchases_account: '5003',
    cogs_account: '5103',
    sales_returns_account: '4103',
    purch_returns_account: '5203',
    is_active: 1,
  },
  // DOMESTIC × EQUIP
  {
    bus_posting_group_code: 'DOMESTIC',
    prod_posting_group_code: 'EQUIP',
    sales_account: '4004',
    purchases_account: '5004',
    cogs_account: '5104',
    sales_returns_account: '4104',
    purch_returns_account: '5204',
    is_active: 1,
  },
  // EXPORT × FERT
  {
    bus_posting_group_code: 'EXPORT',
    prod_posting_group_code: 'FERT',
    sales_account: '4011',           // إيرادات تصدير أسمدة
    purchases_account: '5001',
    cogs_account: '5101',
    sales_returns_account: '4111',
    purch_returns_account: '5201',
    is_active: 1,
  },
  // INTERNAL × * (NULL/NULL catch-all)
  {
    bus_posting_group_code: null,
    prod_posting_group_code: null,
    sales_account: '4999',           // إيرادات متنوعة
    purchases_account: '5999',       // مشتريات متنوعة
    cogs_account: '5199',            // تكلفة متنوعة
    sales_returns_account: '4199',
    purch_returns_account: '5299',
    is_active: 1,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// 5. Inventory Posting Setup (Inventory × Product)
// ═══════════════════════════════════════════════════════════════════════════
const inventoryPostingSetup = [
  // FERT-WH × FERT
  {
    inv_posting_group_code: 'FERT-WH',
    prod_posting_group_code: 'FERT',
    inventory_account: '1301',  // مخزون أسمدة
    is_active: 1,
  },
  // SEED-WH × SEED
  {
    inv_posting_group_code: 'SEED-WH',
    prod_posting_group_code: 'SEED',
    inventory_account: '1302',  // مخزون بذور
    is_active: 1,
  },
  // CHEM-WH × CHEM
  {
    inv_posting_group_code: 'CHEM-WH',
    prod_posting_group_code: 'CHEM',
    inventory_account: '1303',  // مخزون مبيدات
    is_active: 1,
  },
  // MAIN-WH × * (catch-all)
  {
    inv_posting_group_code: 'MAIN-WH',
    prod_posting_group_code: null,
    inventory_account: '1399',  // مخزون متنوع
    is_active: 1,
  },
  // NULL × NULL (catch-all)
  {
    inv_posting_group_code: null,
    prod_posting_group_code: null,
    inventory_account: '1399',
    is_active: 1,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════
async function apiCall(method, path, body = null) {
  const url = `${API_BASE}${path}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(url, options);
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error: ${response.status} - ${error}`);
  }
  
  return response.json();
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Execution
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('═'.repeat(80));
  console.log('🚀 إعداد Posting Groups');
  console.log('═'.repeat(80));
  
  try {
    // 1. Create Business Posting Groups
    console.log('\n📊 1. إنشاء Business Posting Groups...');
    for (const group of businessPostingGroups) {
      try {
        await apiCall('POST', '/gl/posting-groups/business', group);
        console.log(`  ✅ ${group.code} - ${group.name}`);
      } catch (error) {
        console.log(`  ⚠️  ${group.code} - ${error.message}`);
      }
    }
    
    // 2. Create Product Posting Groups
    console.log('\n📦 2. إنشاء Product Posting Groups...');
    for (const group of productPostingGroups) {
      try {
        await apiCall('POST', '/gl/posting-groups/product', group);
        console.log(`  ✅ ${group.code} - ${group.name}`);
      } catch (error) {
        console.log(`  ⚠️  ${group.code} - ${error.message}`);
      }
    }
    
    // 3. Create Inventory Posting Groups
    console.log('\n🏭 3. إنشاء Inventory Posting Groups...');
    for (const group of inventoryPostingGroups) {
      try {
        await apiCall('POST', '/gl/posting-groups/inventory', group);
        console.log(`  ✅ ${group.code} - ${group.name}`);
      } catch (error) {
        console.log(`  ⚠️  ${group.code} - ${error.message}`);
      }
    }
    
    // 4. Create General Posting Setup
    console.log('\n⚙️  4. إنشاء General Posting Setup...');
    for (const setup of generalPostingSetup) {
      try {
        await apiCall('POST', '/gl/posting-setup/general', setup);
        const bpg = setup.bus_posting_group_code || 'NULL';
        const ppg = setup.prod_posting_group_code || 'NULL';
        console.log(`  ✅ ${bpg} × ${ppg}`);
      } catch (error) {
        console.log(`  ⚠️  ${error.message}`);
      }
    }
    
    // 5. Create Inventory Posting Setup
    console.log('\n📦 5. إنشاء Inventory Posting Setup...');
    for (const setup of inventoryPostingSetup) {
      try {
        await apiCall('POST', '/gl/posting-setup/inventory', setup);
        const ipg = setup.inv_posting_group_code || 'NULL';
        const ppg = setup.prod_posting_group_code || 'NULL';
        console.log(`  ✅ ${ipg} × ${ppg}`);
      } catch (error) {
        console.log(`  ⚠️  ${error.message}`);
      }
    }
    
    // 6. Health Check
    console.log('\n🏥 6. فحص الصحة (Health Check)...');
    const health = await apiCall('GET', '/gl/posting-setup/health');
    console.log(JSON.stringify(health, null, 2));
    
    if (health.is_ready) {
      console.log('\n✅ النظام جاهز لتفعيل Posting Engine!');
    } else {
      console.log('\n⚠️  النظام غير جاهز. يرجى مراجعة الأخطاء:');
      health.issues.forEach(issue => console.log(`  ❌ ${issue}`));
    }
    
  } catch (error) {
    console.error('\n❌ خطأ:', error.message);
    process.exit(1);
  }
  
  console.log('\n' + '═'.repeat(80));
  console.log('✅ انتهى الإعداد');
  console.log('═'.repeat(80));
}

// Run
main().catch(console.error);
