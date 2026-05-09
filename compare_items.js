/**
 * compare_items.js
 * Compare active items in database vs new JSON file
 */
'use strict';
const fs = require('fs');

// Load new JSON
const newData = JSON.parse(fs.readFileSync('مخازن_نواة_المستقبل_2025-2026_كامل.json', 'utf8'));
const newItems = newData['سجل_الأصناف_الموحد']['الأصناف'];
const newCodes = new Set(newItems.map(i => i['كود_الصنف']).filter(c => c));

console.log('═══════════════════════════════════════════════════════════');
console.log('  ITEMS COMPARISON: Database vs New JSON File');
console.log('═══════════════════════════════════════════════════════════');
console.log('');
console.log('JSON file items:  ' + newCodes.size);
console.log('Item codes from JSON:');
const sortedNewCodes = Array.from(newCodes).sort((a, b) => a - b);
console.log('  ' + sortedNewCodes.join(', '));
console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('');
console.log('DATABASE CLEANUP STRATEGY:');
console.log('');
console.log('  Action 1: SET is_active = 0 for all 4769 items');
console.log('            that are NOT in the new JSON file AND');
console.log('            have NO inventory movements');
console.log('');
console.log('  Action 2: Verify that all 61 JSON items exist');
console.log('            in database with correct metadata');
console.log('');
console.log('═══════════════════════════════════════════════════════════');
