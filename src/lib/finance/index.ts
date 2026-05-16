// Finance Module - Refactored Structure
// ======================================

// Business Events - Core posting engine
export { postFromBusinessEvent, syncSourceDocumentBridge } from './business_events'
export type { EventBackedPostOpts } from './business_events'

// Cash Movement Operations
export { prepareCashMovement, commitCashDrafts, postCashMovement } from './cash_movement'

// Resolvers - All resolve* functions organized by domain
export {
  // Inventory
  resolveInventoryMovement,
  resolveInventoryTransfer,
  resolvePurchaseReceipt,
  processPOReceiptOrchestrated,
  enrichPOReceiptItems,
  // Suppliers
  resolveSupplierInvoice,
  resolveSupplierPayment,
  // Cash & Revenue
  resolveCashLedger,
  resolveExpensePosting,
  resolveSalesRevenue,
  // Payroll
  resolvePayrollPosting,
  resolvePayrollPayment,
  // Operations
  resolveWorkOrderLabor,
  resolveContractAdvance,
  // Partners
  resolvePartnerCapital,
  resolvePartnerCurrent,
  // Manual Entries
  postManualEntry,
  postManualReversal,
} from './resolvers'
