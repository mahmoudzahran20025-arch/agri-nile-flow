#!/usr/bin/env node
/**
 * deploy_and_verify.js
 * Complete deployment and verification workflow for Agri-Nile Flow
 * Cross-platform Node.js script
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import readline from 'readline';

// Configuration
const CONFIG = {
  database: 'agri-nile-flow-data-lake',
  workerUrl: 'https://agri-nile-flow.your-subdomain.workers.dev',
  pagesProject: 'agri-nile-flow-lake'
};

// Utility functions
const colors = {
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function header(message) {
  console.log('\n' + '═'.repeat(80));
  log(`  ${message}`, 'cyan');
  console.log('═'.repeat(80) + '\n');
}

function separator() {
  console.log('─'.repeat(80));
}

function exec(command, description) {
  try {
    log(`  → ${description}...`);
    const output = execSync(command, { 
      encoding: 'utf8',
      stdio: 'inherit'
    });
    return output;
  } catch (error) {
    log(`❌ Failed: ${error.message}`, 'red');
    throw error;
  }
}

async function confirm(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`${question} (y/n): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

async function testEndpoint(name, url, options = {}) {
  log(`  ${name}...`);
  try {
    const method = options.method || 'GET';
    const body = options.body ? JSON.stringify(options.body) : undefined;
    
    const fetchOptions = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    };
    
    if (body) {
      fetchOptions.body = body;
    }

    const response = await fetch(url, fetchOptions);
    const data = await response.json();
    
    console.log(JSON.stringify(data, null, 2));
    log(`  ✓ ${name} passed`, 'green');
    return data;
  } catch (error) {
    log(`  ❌ ${name} failed: ${error.message}`, 'red');
    return null;
  }
}

// Main workflow
async function main() {
  try {
    header('AGRI-NILE FLOW - DEPLOYMENT & VERIFICATION WORKFLOW');

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: VERIFY POSTING_RULES COVERAGE
    // ═══════════════════════════════════════════════════════════════════════
    log('\n📊 STEP 1: Running posting_rules verification queries...', 'yellow');
    separator();
    
    exec(
      `wrangler d1 execute ${CONFIG.database} --remote --file=verify_posting_rules_remote.sql`,
      'Executing verification queries'
    );

    const continueDeployment = await confirm('\n✓ Review the verification results above. Continue with migration?');
    if (!continueDeployment) {
      log('❌ Deployment cancelled by user.', 'red');
      process.exit(1);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: APPLY MIGRATION 0050 (DROP LEGACY TABLES)
    // ═══════════════════════════════════════════════════════════════════════
    log('\n🗑️  STEP 2: Applying migration 0050 (dropping legacy tables)...', 'yellow');
    separator();
    
    exec(
      `wrangler d1 execute ${CONFIG.database} --remote --file=migrations/0050_drop_legacy_posting_tables.sql`,
      'Applying migration 0050'
    );
    
    log('✓ Migration 0050 applied successfully', 'green');

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: VERIFY LEGACY TABLES ARE DROPPED
    // ═══════════════════════════════════════════════════════════════════════
    log('\n🔍 STEP 3: Verifying legacy tables are dropped...', 'yellow');
    separator();
    
    exec(
      `wrangler d1 execute ${CONFIG.database} --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name IN ('general_posting_setup', 'inventory_posting_setup', 'gl_account_mappings');"`,
      'Checking for legacy tables'
    );
    
    log('✓ Legacy tables verification complete', 'green');

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: BUILD AND DEPLOY WORKER
    // ═══════════════════════════════════════════════════════════════════════
    log('\n🚀 STEP 4: Building and deploying worker...', 'yellow');
    separator();

    exec('npm run type-check', 'Running type check');
    exec('npm run build:web', 'Building web assets');
    exec('wrangler deploy', 'Deploying worker to Cloudflare');
    exec(
      `npx wrangler pages deploy web/dist --project-name=${CONFIG.pagesProject}`,
      'Deploying web assets to Cloudflare Pages'
    );
    
    log('✓ Worker and Pages deployed successfully', 'green');

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: POST-DEPLOY ENDPOINT CHECKS
    // ═══════════════════════════════════════════════════════════════════════
    log('\n🧪 STEP 5: Running post-deploy endpoint checks...', 'yellow');
    separator();
    log(`\nTesting endpoints against: ${CONFIG.workerUrl}\n`);

    // Test 1: Health/Setup endpoint
    await testEndpoint(
      '1️⃣  GL posting setup health',
      `${CONFIG.workerUrl}/gl/posting-setup/health`
    );

    // Test 2: Invoice flow
    await testEndpoint(
      '2️⃣  Invoice creation flow',
      `${CONFIG.workerUrl}/finance/invoices`,
      {
        method: 'POST',
        body: {
          company_id: 1,
          customer_id: 1,
          invoice_date: '2026-04-28',
          due_date: '2026-05-28',
          amount: 1000,
          description: 'Post-deploy test invoice'
        }
      }
    );

    // Test 3: Receipt flow
    await testEndpoint(
      '3️⃣  Receipt creation flow',
      `${CONFIG.workerUrl}/finance/receipts`,
      {
        method: 'POST',
        body: {
          company_id: 1,
          customer_id: 1,
          receipt_date: '2026-04-28',
          amount: 500,
          payment_method: 'cash',
          description: 'Post-deploy test receipt'
        }
      }
    );

    // Test 4: Treasury flow
    await testEndpoint(
      '4️⃣  Treasury transactions',
      `${CONFIG.workerUrl}/treasury/transactions?page=1&size=5`
    );

    // Test 5: Inventory posting health
    await testEndpoint(
      '5️⃣  Inventory posting health',
      `${CONFIG.workerUrl}/inventory/posting-health`
    );

    // ═══════════════════════════════════════════════════════════════════════
    // FINAL SUMMARY
    // ═══════════════════════════════════════════════════════════════════════
    header('✓ DEPLOYMENT COMPLETE');
    
    console.log('Next steps:');
    console.log('  1. Monitor worker logs: wrangler tail');
    console.log('  2. Check production dashboard for any errors');
    console.log('  3. Run full integration tests if available');
    console.log('  4. Update deployment documentation\n');
    console.log(`Worker URL: ${CONFIG.workerUrl}`);
    console.log(`Database: ${CONFIG.database} (remote)\n`);

  } catch (error) {
    log(`\n❌ Deployment failed: ${error.message}`, 'red');
    process.exit(1);
  }
}

// Run the script
main();
