/**
 * Refund Payment Tool
 *
 * Refunds a Stripe payment (full or partial).
 * Creates a refund transaction and updates the original transaction status.
 *
 * @module tools/payment/refund_payment
 */

import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'
import { getData } from '@/lib/data-layer'
import Stripe from 'stripe'

interface RefundPaymentInput {
  payment_id?: string
  transaction_id?: string
  amount?: number
  reason: 'duplicate' | 'fraudulent' | 'requested_by_customer' | 'other'
  metadata?: Record<string, any>
}

interface RefundPaymentOutput {
  success: boolean
  result?: {
    refund_id: string
    charge_id: string
    amount_refunded: number
    currency: string
    status: string
    reason: string
    original_transaction_id: string
    refund_transaction_id: string
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
 * Refund a payment
 */
export default async function refund_payment(
  input: RefundPaymentInput,
  context: ToolContext
): Promise<RefundPaymentOutput> {
  const startTime = Date.now()

  try {
    const { payment_id, transaction_id, amount, reason, metadata = {} } = input

    // Validation
    if (!payment_id && !transaction_id) {
      throw new Error('Either payment_id or transaction_id is required')
    }

    logger.info('[refund_payment] Starting refund process', {
      has_payment_id: !!payment_id,
      has_transaction_id: !!transaction_id,
      partial_refund: !!amount,
      reason,
    })

    const stripe = getStripeClient()
    const dataLayer = getData(context)

    // If transaction_id provided, look up payment_id from database
    let chargeId = payment_id
    let originalTransactionData: any = null

    if (transaction_id && !payment_id) {
      logger.debug('[refund_payment] Looking up transaction', { transaction_id })

      try {
        originalTransactionData = await dataLayer.read(
          'transactions',
          context.tenantId || 'global',
          transaction_id
        )

        if (originalTransactionData) {
          chargeId = originalTransactionData.charge_id || originalTransactionData.payment_intent_id
          logger.debug('[refund_payment] Transaction found', { chargeId })
        }
      } catch (error) {
        logger.warn('[refund_payment] Could not look up transaction', { transaction_id })
        if (!chargeId) {
          throw new Error(`Transaction ${transaction_id} not found`)
        }
      }
    }

    if (!chargeId) {
      throw new Error('Could not determine payment ID for refund')
    }

    // Create refund
    logger.debug('[refund_payment] Creating refund', { chargeId, amount })

    const refundParams: Stripe.RefundCreateParams = {
      reason,
      metadata: {
        user_id: context.userId,
        tenant_id: context.tenantId,
        original_transaction_id: transaction_id,
        ...metadata,
      },
    }

    if (amount) {
      refundParams.amount = Math.round(amount)
    }

    const refund = await stripe.refunds.create(refundParams, {
      idempotencyKey: `refund_${chargeId}_${reason}_${Date.now()}`,
    } as any)

    logger.info('[refund_payment] Refund created', {
      refund_id: refund.id,
      charge_id: refund.charge,
      amount: refund.amount,
      status: refund.status,
    })

    // Update original transaction status
    if (transaction_id && originalTransactionData) {
      const updateData = {
        status: amount ? 'partially_refunded' : 'refunded',
        refund_ids: [refund.id, ...(originalTransactionData.refund_ids || [])],
        updated_at: new Date().toISOString(),
      }

      logger.debug('[refund_payment] Updating original transaction', {
        transaction_id,
        new_status: updateData.status,
      })

      await dataLayer.update('transactions', context.tenantId || 'global', transaction_id, updateData)
    }

    // Create refund transaction record
    const refundTransactionId = `refund_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const now = new Date().toISOString()

    const refundTransactionData = {
      id: refundTransactionId,
      refund_id: refund.id,
      charge_id: refund.charge,
      original_transaction_id: transaction_id,
      amount_refunded: refund.amount,
      currency: refund.currency || 'usd',
      status: refund.status,
      reason,
      metadata: {
        user_id: context.userId,
        tenant_id: context.tenantId,
        ...metadata,
      },
      created_at: now,
      updated_at: now,
      user_id: context.userId,
      tenant_id: context.tenantId,
    }

    await dataLayer.create(
      'transactions',
      context.tenantId || 'global',
      refundTransactionId,
      refundTransactionData
    )

    logger.info('[refund_payment] Refund transaction recorded', {
      refund_transaction_id: refundTransactionId,
      refund_id: refund.id,
      duration_ms: Date.now() - startTime,
    })

    return {
      success: true,
      result: {
        refund_id: refund.id,
        charge_id: (refund.charge as string) || '',
        amount_refunded: refund.amount,
        currency: refund.currency || 'usd',
        status: refund.status,
        reason,
        original_transaction_id: transaction_id || '',
        refund_transaction_id: refundTransactionId,
        created_at: now,
      },
    }
  } catch (error) {
    const duration = Date.now() - startTime

    logger.error('[refund_payment] Refund processing failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: duration,
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
