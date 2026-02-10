/**
 * Create Invoice Tool
 *
 * Creates and finalizes a Stripe invoice for a customer.
 * Supports multiple line items and custom due dates.
 *
 * @module tools/payment/create_invoice
 */

import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'
import { getData } from '@/lib/data-layer'
import Stripe from 'stripe'

interface InvoiceItem {
  name: string
  amount: number
  quantity?: number
  currency?: string
}

interface CreateInvoiceInput {
  customer_id?: string
  customer_email?: string
  customer_name?: string
  items: InvoiceItem[]
  due_date?: string
  description?: string
  metadata?: Record<string, any>
  auto_advance?: boolean
}

interface CreateInvoiceOutput {
  success: boolean
  result?: {
    invoice_id: string
    customer_id: string
    amount_total: number
    currency: string
    status: string
    invoice_url: string
    due_date?: string
    transaction_id: string
    created_at: string
  }
  error?: string
}

/**
 * Initialize Stripe client
 */
function getStripeClient(): Stripe {
  const apiKey = process.env.STRIPE_SECRET_KEY
  if (!apiKey) {
    throw new Error('STRIPE_SECRET_KEY environment variable is not set')
  }
  return new Stripe(apiKey, { apiVersion: '2024-04-10' as any })
}

/**
 * Calculate due date
 */
function calculateDueDate(daysFromNow: number): Date {
  const date = new Date()
  date.setDate(date.getDate() + daysFromNow)
  return date
}

/**
 * Create and finalize an invoice
 */
export default async function create_invoice(
  input: CreateInvoiceInput,
  context: ToolContext
): Promise<CreateInvoiceOutput> {
  const startTime = Date.now()

  try {
    const {
      customer_id,
      customer_email,
      customer_name,
      items,
      due_date,
      description,
      metadata = {},
      auto_advance = true,
    } = input

    // Validation
    if (!items || items.length === 0) {
      throw new Error('At least one invoice item is required')
    }

    logger.info('[create_invoice] Starting invoice creation', {
      item_count: items.length,
      has_customer_id: !!customer_id,
      has_due_date: !!due_date,
    })

    const stripe = getStripeClient()

    // Get or create customer
    let customerId = customer_id

    if (!customerId) {
      if (!customer_email) {
        throw new Error('Either customer_id or customer_email is required')
      }

      logger.debug('[create_invoice] Creating new Stripe customer', { customer_email })

      const customer = await stripe.customers.create({
        email: customer_email,
        name: customer_name,
        metadata: {
          user_id: context.userId,
          tenant_id: context.tenantId,
        },
      })

      customerId = customer.id
      logger.debug('[create_invoice] Customer created', { customerId })
    }

    // Create invoice
    logger.debug('[create_invoice] Creating invoice', { customerId, item_count: items.length })

    const invoiceParams: Stripe.InvoiceCreateParams = {
      customer: customerId,
      description,
      metadata: {
        user_id: context.userId,
        tenant_id: context.tenantId,
        ...metadata,
      },
      auto_advance: false, // We'll finalize manually to ensure consistency
    }

    // Set due date if provided
    if (due_date) {
      invoiceParams.due_date = Math.floor(new Date(due_date).getTime() / 1000)
    } else {
      // Default to 30 days from now
      const defaultDueDate = calculateDueDate(30)
      invoiceParams.due_date = Math.floor(defaultDueDate.getTime() / 1000)
    }

    const invoice = await stripe.invoices.create(invoiceParams)

    // Add line items
    let totalAmount = 0
    const currency = items[0]?.currency || 'usd'

    for (const item of items) {
      const quantity = item.quantity || 1
      const amount = item.amount * quantity

      logger.debug('[create_invoice] Adding line item', {
        name: item.name,
        amount: item.amount,
        quantity,
      })

      await stripe.invoiceItems.create({
        invoice: invoice.id,
        customer: customerId,
        amount: Math.round(amount),
        currency: item.currency || currency,
        description: item.name,
      })

      totalAmount += amount
    }

    // Finalize invoice
    logger.debug('[create_invoice] Finalizing invoice', { invoice_id: invoice.id })

    const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id)

    logger.info('[create_invoice] Invoice created and finalized', {
      invoice_id: finalizedInvoice.id,
      customer_id: customerId,
      amount_total: finalizedInvoice.total,
      status: finalizedInvoice.status,
    })

    // Store transaction in database
    const dataLayer = getData(context)
    const transactionId = `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const now = new Date().toISOString()

    const transactionData = {
      id: transactionId,
      invoice_id: finalizedInvoice.id,
      customer_id: customerId,
      amount: finalizedInvoice.total || 0,
      currency: finalizedInvoice.currency,
      status: finalizedInvoice.status,
      description,
      metadata: {
        user_id: context.userId,
        tenant_id: context.tenantId,
        invoice_url: finalizedInvoice.hosted_invoice_url,
        line_items_count: items.length,
        ...metadata,
      },
      created_at: now,
      updated_at: now,
      user_id: context.userId,
      tenant_id: context.tenantId,
    }

    await dataLayer.create('transactions', context.tenantId || 'global', transactionId, transactionData)

    logger.info('[create_invoice] Transaction recorded', {
      transaction_id: transactionId,
      invoice_id: finalizedInvoice.id,
      duration_ms: Date.now() - startTime,
    })

    return {
      success: true,
      result: {
        invoice_id: finalizedInvoice.id,
        customer_id: customerId,
        amount_total: finalizedInvoice.total || 0,
        currency: finalizedInvoice.currency,
        status: finalizedInvoice.status,
        invoice_url: finalizedInvoice.hosted_invoice_url || '',
        due_date: due_date || new Date(calculateDueDate(30)).toISOString().split('T')[0],
        transaction_id: transactionId,
        created_at: now,
      },
    }
  } catch (error) {
    const duration = Date.now() - startTime

    logger.error('[create_invoice] Invoice creation failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: duration,
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
