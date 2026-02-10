/**
 * Get Payment Status Tool
 *
 * Retrieves the current status of a payment.
 * Queries database first, then Stripe API for latest status.
 *
 * @module tools/payment/get_payment_status
 */

import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'
import { getData } from '@/lib/data-layer'
import Stripe from 'stripe'

interface GetPaymentStatusInput {
  payment_id?: string
  transaction_id?: string
  include_refunds?: boolean
  include_charges?: boolean
}

interface PaymentStatusResult {
  transaction_id: string
  payment_id: string
  status: string
  amount: number
  currency: string
  customer_id: string
  created_at: string
  updated_at: string
  refunds?: any[]
  charges?: any[]
  metadata?: Record<string, any>
}

interface GetPaymentStatusOutput {
  success: boolean
  result?: PaymentStatusResult
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
 * Get payment status
 */
export default async function get_payment_status(
  input: GetPaymentStatusInput,
  context: ToolContext
): Promise<GetPaymentStatusOutput> {
  try {
    const {
      payment_id,
      transaction_id,
      include_refunds = true,
      include_charges = true,
    } = input

    // Validation
    if (!payment_id && !transaction_id) {
      throw new Error('Either payment_id or transaction_id is required')
    }

    logger.info('[get_payment_status] Fetching payment status', {
      has_payment_id: !!payment_id,
      has_transaction_id: !!transaction_id,
    })

    const stripe = getStripeClient()
    const dataLayer = getData(context)

    let transactionData: any = null
    let chargeId = payment_id

    // If transaction_id provided, look up from database first
    if (transaction_id) {
      logger.debug('[get_payment_status] Looking up transaction', { transaction_id })

      try {
        transactionData = await dataLayer.read(
          'transactions',
          context.tenantId || 'global',
          transaction_id
        )

        if (transactionData) {
          chargeId = transactionData.payment_id || transactionData.charge_id || transactionData.payment_intent_id
          logger.debug('[get_payment_status] Transaction found', { chargeId })
        }
      } catch (error) {
        logger.warn('[get_payment_status] Could not look up transaction', { transaction_id })
      }
    }

    if (!chargeId) {
      throw new Error('Could not determine payment ID')
    }

    // Fetch from Stripe for latest status
    logger.debug('[get_payment_status] Fetching from Stripe', { chargeId })

    let stripePayment: any = null
    let refunds: any[] = []
    let charges: any[] = []

    try {
      // Try to get as a charge first
      const charge = await stripe.charges.retrieve(chargeId)
      stripePayment = charge
      logger.debug('[get_payment_status] Charge retrieved', { chargeId })

      if (include_refunds) {
        const refundsList = await stripe.refunds.list({
          charge: chargeId,
          limit: 100,
        })
        refunds = refundsList.data.map((r) => ({
          refund_id: r.id,
          amount: r.amount,
          status: r.status,
          reason: r.reason,
          created_at: new Date(r.created * 1000).toISOString(),
        }))
      }

      if (include_charges && charge.refunded) {
        const chargesList = await stripe.charges.list({
          customer: charge.customer as string,
          limit: 100,
        })
        charges = chargesList.data.map((c) => ({
          charge_id: c.id,
          amount: c.amount,
          status: c.status,
          created_at: new Date(c.created * 1000).toISOString(),
        }))
      }
    } catch {
      // If not a charge, try payment intent
      logger.debug('[get_payment_status] Charge not found, trying payment intent', { chargeId })

      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(chargeId)
        stripePayment = paymentIntent
        logger.debug('[get_payment_status] Payment intent retrieved', { chargeId })

        if (include_charges && paymentIntent.charges.data.length > 0) {
          charges = paymentIntent.charges.data.map((c) => ({
            charge_id: c.id,
            amount: c.amount,
            status: c.status,
            created_at: new Date(c.created * 1000).toISOString(),
          }))

          if (include_refunds) {
            for (const charge of paymentIntent.charges.data) {
              const refundsList = await stripe.refunds.list({
                charge: charge.id,
                limit: 100,
              })
              refunds.push(
                ...refundsList.data.map((r) => ({
                  refund_id: r.id,
                  amount: r.amount,
                  status: r.status,
                  reason: r.reason,
                  created_at: new Date(r.created * 1000).toISOString(),
                }))
              )
            }
          }
        }
      } catch (error) {
        logger.warn('[get_payment_status] Could not retrieve payment from Stripe', {
          chargeId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (!stripePayment) {
      throw new Error(`Payment ${chargeId} not found in Stripe`)
    }

    // Build result
    const result: PaymentStatusResult = {
      transaction_id: transaction_id || chargeId,
      payment_id: chargeId,
      status: stripePayment.status || (stripePayment.refunded ? 'refunded' : 'completed'),
      amount: stripePayment.amount || stripePayment.amount_total || 0,
      currency: stripePayment.currency || 'usd',
      customer_id: (stripePayment.customer as string) || '',
      created_at: transactionData?.created_at || new Date(stripePayment.created * 1000).toISOString(),
      updated_at: transactionData?.updated_at || new Date().toISOString(),
      metadata: transactionData?.metadata || {},
    }

    if (refunds.length > 0) {
      result.refunds = refunds
    }

    if (charges.length > 0) {
      result.charges = charges
    }

    logger.info('[get_payment_status] Payment status retrieved', {
      payment_id: chargeId,
      status: result.status,
      amount: result.amount,
    })

    return {
      success: true,
      result,
    }
  } catch (error) {
    logger.error('[get_payment_status] Failed to retrieve payment status', {
      error: error instanceof Error ? error.message : String(error),
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
