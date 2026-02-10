/**
 * List Transactions Tool
 *
 * Lists transactions with filtering and pagination.
 * Returns summary statistics including totals and counts.
 *
 * @module tools/payment/list_transactions
 */

import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'
import { getData } from '@/lib/data-layer'

interface ListTransactionsInput {
  start_date?: string
  end_date?: string
  status?: string
  transaction_type?: string
  customer_id?: string
  limit?: number
  offset?: number
  sort_by?: 'created_at' | 'amount'
  sort_order?: 'asc' | 'desc'
}

interface Transaction {
  id: string
  payment_intent_id?: string
  invoice_id?: string
  refund_id?: string
  customer_id: string
  amount: number
  currency: string
  status: string
  description?: string
  created_at: string
}

interface TransactionSummary {
  total_transactions: number
  total_amount: number
  average_transaction: number
  min_transaction: number
  max_transaction: number
  by_status: Record<string, number>
  by_type: Record<string, number>
}

interface ListTransactionsOutput {
  success: boolean
  result?: {
    transactions: Transaction[]
    pagination: {
      total: number
      limit: number
      offset: number
      has_more: boolean
    }
    summary: TransactionSummary
  }
  error?: string
}

/**
 * Parse and validate date
 */
function parseDate(dateStr?: string): Date | null {
  if (!dateStr) return null

  const date = new Date(dateStr)
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${dateStr}. Use YYYY-MM-DD`)
  }

  return date
}

/**
 * Filter transactions based on criteria
 */
function filterTransactions(
  transactions: any[],
  filters: ListTransactionsInput
): any[] {
  return transactions.filter((txn) => {
    // Date range filter
    if (filters.start_date) {
      const startDate = parseDate(filters.start_date)
      if (startDate && new Date(txn.created_at) < startDate) {
        return false
      }
    }

    if (filters.end_date) {
      const endDate = parseDate(filters.end_date)
      // Add 1 day to include all transactions on the end date
      if (endDate) {
        endDate.setDate(endDate.getDate() + 1)
        if (new Date(txn.created_at) >= endDate) {
          return false
        }
      }
    }

    // Status filter
    if (filters.status && txn.status !== filters.status) {
      return false
    }

    // Customer filter
    if (filters.customer_id && txn.customer_id !== filters.customer_id) {
      return false
    }

    // Type filter
    if (filters.transaction_type) {
      const type = txn.refund_id ? 'refund' : txn.invoice_id ? 'invoice' : 'payment'
      if (type !== filters.transaction_type) {
        return false
      }
    }

    return true
  })
}

/**
 * Sort transactions
 */
function sortTransactions(
  transactions: any[],
  sortBy: 'created_at' | 'amount' = 'created_at',
  sortOrder: 'asc' | 'desc' = 'desc'
): any[] {
  const sorted = [...transactions]

  sorted.sort((a, b) => {
    let compareA, compareB

    if (sortBy === 'amount') {
      compareA = a.amount || 0
      compareB = b.amount || 0
    } else {
      compareA = new Date(a.created_at).getTime()
      compareB = new Date(b.created_at).getTime()
    }

    const result = compareA > compareB ? 1 : compareA < compareB ? -1 : 0
    return sortOrder === 'desc' ? -result : result
  })

  return sorted
}

/**
 * Calculate transaction summary
 */
function calculateSummary(transactions: any[]): TransactionSummary {
  const summary: TransactionSummary = {
    total_transactions: transactions.length,
    total_amount: 0,
    average_transaction: 0,
    min_transaction: Infinity,
    max_transaction: 0,
    by_status: {},
    by_type: {},
  }

  for (const txn of transactions) {
    // Amount stats
    summary.total_amount += txn.amount || 0
    summary.min_transaction = Math.min(summary.min_transaction, txn.amount || 0)
    summary.max_transaction = Math.max(summary.max_transaction, txn.amount || 0)

    // Status counts
    summary.by_status[txn.status] = (summary.by_status[txn.status] || 0) + 1

    // Type counts
    const type = txn.refund_id ? 'refund' : txn.invoice_id ? 'invoice' : 'payment'
    summary.by_type[type] = (summary.by_type[type] || 0) + 1
  }

  if (summary.total_transactions > 0) {
    summary.average_transaction = summary.total_amount / summary.total_transactions
  }

  // Handle Infinity edge case
  if (summary.min_transaction === Infinity) {
    summary.min_transaction = 0
  }

  return summary
}

/**
 * List transactions with filtering and pagination
 */
export default async function list_transactions(
  input: ListTransactionsInput,
  context: ToolContext
): Promise<ListTransactionsOutput> {
  try {
    const {
      limit = 50,
      offset = 0,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = input

    // Validation
    if (limit < 1 || limit > 1000) {
      throw new Error('Limit must be between 1 and 1000')
    }

    if (offset < 0) {
      throw new Error('Offset must be >= 0')
    }

    logger.info('[list_transactions] Fetching transactions', {
      limit,
      offset,
      has_filters: Object.keys(input).length > 3,
    })

    const dataLayer = getData(context)

    // List all transactions for the tenant
    let allTransactions: any[] = []

    try {
      allTransactions = await dataLayer.list('transactions', context.tenantId || 'global')
    } catch (error) {
      logger.warn('[list_transactions] Could not list transactions from database', {
        error: error instanceof Error ? error.message : String(error),
      })
      allTransactions = []
    }

    // Apply filters
    let filtered = filterTransactions(allTransactions, input)

    logger.debug('[list_transactions] Filters applied', {
      total_loaded: allTransactions.length,
      after_filters: filtered.length,
    })

    // Calculate summary before pagination
    const summary = calculateSummary(filtered)

    // Sort
    const sorted = sortTransactions(filtered, sort_by, sort_order)

    // Paginate
    const total = sorted.length
    const paginated = sorted.slice(offset, offset + limit)

    logger.info('[list_transactions] Transactions retrieved', {
      total_count: total,
      returned_count: paginated.length,
      offset,
      limit,
    })

    // Format result
    const transactions: Transaction[] = paginated.map((txn) => ({
      id: txn.id,
      payment_intent_id: txn.payment_intent_id,
      invoice_id: txn.invoice_id,
      refund_id: txn.refund_id,
      customer_id: txn.customer_id,
      amount: txn.amount,
      currency: txn.currency,
      status: txn.status,
      description: txn.description,
      created_at: txn.created_at,
    }))

    return {
      success: true,
      result: {
        transactions,
        pagination: {
          total,
          limit,
          offset,
          has_more: offset + limit < total,
        },
        summary,
      },
    }
  } catch (error) {
    logger.error('[list_transactions] Failed to list transactions', {
      error: error instanceof Error ? error.message : String(error),
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
