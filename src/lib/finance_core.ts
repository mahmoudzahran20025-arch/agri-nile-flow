/**
 * FinanceCore - Facade/Factory Pattern
 * ====================================
 * This file serves as the main entry point for all finance-related operations.
 * It re-exports all functions from the modularized finance directory.
 * 
 * The actual implementations have been split into:
 * - business_events.ts: Core business event posting logic
 * - cash_movement.ts: Cash transaction operations
 * - resolvers/: Domain-specific resolver functions
 */

// Import all modules from the finance directory
import {
  // Business Events
  postFromBusinessEvent,
  syncSourceDocumentBridge,
  // Cash Movement
  prepareCashMovement,
  commitCashDrafts,
  postCashMovement,
  // Inventory Resolvers
  resolveInventoryMovement,
  resolveInventoryTransfer,
  resolvePurchaseReceipt,
  // Supplier Resolvers
  resolveSupplierInvoice,
  resolveSupplierPayment,
  // Cash & Revenue Resolvers
  resolveCashLedger,
  resolveExpensePosting,
  resolveSalesRevenue,
  // Payroll Resolvers
  resolvePayrollPosting,
  resolvePayrollPayment,
  // Operations Resolvers
  resolveWorkOrderLabor,
  resolveContractAdvance,
  // Partner Resolvers
  resolvePartnerCapital,
  resolvePartnerCurrent,
  // Manual Entry Resolvers
  postManualEntry,
  postManualReversal,
} from './finance'

// Re-export types
export type { EventBackedPostOpts } from './finance/business_events'

/**
 * FinanceCore - The main facade for all finance operations
 * All functions are delegated to their respective modules
 */
export const FinanceCore = {
  // Cash Operations
  prepareCashMovement,
  commitCashDrafts,
  postCashMovement,

  // Backward compatibility alias
  recordCashMovement: prepareCashMovement,

  // Inventory Resolvers
  resolveInventoryMovement,
  resolveInventoryTransfer,
  resolvePurchaseReceipt,
  // Backward compatibility alias
  processPOReceipt: resolvePurchaseReceipt,

  // Supplier Resolvers
  resolveSupplierInvoice,
  resolveSupplierPayment,

  // Cash & Revenue Resolvers
  resolveCashLedger,
  resolveExpensePosting,
  resolveSalesRevenue,

  // Payroll Resolvers
  resolvePayrollPosting,
  resolvePayrollPayment,

  // Operations Resolvers
  resolveWorkOrderLabor,
  resolveContractAdvance,

  // Partner Resolvers
  resolvePartnerCapital,
  resolvePartnerCurrent,

  // Manual Entry Resolvers
  postManualEntry,
  postManualReversal,
} as const

// Also export individual functions for direct import
export {
  postFromBusinessEvent,
  syncSourceDocumentBridge,
  prepareCashMovement,
  commitCashDrafts,
  resolveInventoryMovement,
  resolveInventoryTransfer,
  resolvePurchaseReceipt,
  resolveSupplierInvoice,
  resolveSupplierPayment,
  resolveCashLedger,
  resolveExpensePosting,
  resolveSalesRevenue,
  resolvePayrollPosting,
  resolvePayrollPayment,
  resolveWorkOrderLabor,
  resolveContractAdvance,
  resolvePartnerCapital,
  resolvePartnerCurrent,
  postManualEntry,
  postManualReversal,
}
