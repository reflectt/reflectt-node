/**
 * Process Payment Tool
 *
 * Processes a payment using Stripe and stores transaction details in the database.
 * Creates a payment intent, confirms the payment, and records the transaction.
 *
 * @module tools/payment/process_payment
 */

import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'
import { getData } from '@/lib/data-layer'
import Stripe from 'stripe'

interface ProcessPaymentInput {
  amount: number
  currency: string
  payment_method_id: string
  customer_id?: string
  customer_email: string
  customer_name?: string
  description?: string
  metadata?: Record<string, any>
  idempotency_key?: string
  return_url?: string
}

interface ProcessPaymentOutput {
  success: boolean
  result?: {
    payment_intent_id: string
    status: string
    amount: number
    currency: string
    customer_id: string
    transaction_id: string
    client_secret?: string
    requires_action?: boolean
    next_action?: any
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
 * Process a payment using Stripe
 */
export default async function process_payment(
  input: ProcessPaymentInput,
  context: ToolContext
): Promise<ProcessPaymentOutput> {
  const startTime = Date.now()

  try {
    const {
      amount,
      currency,
      payment_method_id,
      customer_id,
      customer_email,
      customer_name,
      description,
      metadata = {},
      idempotency_key,
      return_url,
    } = input

    // Validation
    if (!amount || amount <= 0) {
      throw new Error('Amount must be greater than 0')
    }

    if (!currency || currency.length !== 3) {
      throw new Error('Invalid currency code. Use ISO 4217 format (e.g., usd, eur)')
    }

    logger.info('[process_payment] Starting payment processing', {
      amount,
      currency,
      customer_email,
      has_idempotency_key: !!idempotency_key,
    })

    const stripe = getStripeClient()

    // Get or create customer
    let customerId = customer_id

    if (!customerId) {
      logger.debug('[process_payment] Creating new Stripe customer', { customer_email })

      const customer = await stripe.customers.create({
        email: customer_email,
        name: customer_name,
        metadata: {
          user_id: context.userId,
          tenant_id: context.tenantId,
        },
      })

      customerId = customer.id
      logger.debug('[process_payment] Customer created', { customerId })
    }

    // Create payment intent
    const paymentIntentParams: Stripe.PaymentIntentCreateParams = {
      amount,
      currency: currency.toLowerCase(),
      payment_method: payment_method_id,
      customer: customerId,
      description,
      metadata: {
        user_id: context.userId,
        tenant_id: context.tenantId,
        ...metadata,
      },
      confirm: true,
      return_url,
      off_session: false,
    }

    // Add idempotency key if provided
    const requestOptions = idempotency_key ? { idempotencyKey: idempotency_key } : {}

    logger.debug('[process_payment] Creating payment intent', { amount, currency })

    const paymentIntent = await stripe.paymentIntents.create(
      paymentIntentParams,
      requestOptions as any
    )

    logger.info('[process_payment] Payment intent created', {
      payment_intent_id: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount,
    })

    // Store transaction in database
    const dataLayer = getData(context)
    const transactionId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const now = new Date().toISOString()

    const transactionData = {
      id: transactionId,
      payment_intent_id: paymentIntent.id,
      payment_method_id: paymentIntent.payment_method,
      customer_id: customerId,
      amount,
      currency: currency.toLowerCase(),
      status: paymentIntent.status,
      description,
      metadata: {
        user_id: context.userId,
        tenant_id: context.tenantId,
        charge_id: paymentIntent.charges.data[0]?.id,
        ...metadata,
      },
      created_at: now,
      updated_at: now,
      user_id: context.userId,
      tenant_id: context.tenantId,
    }

    await dataLayer.create('transactions', context.tenantId || 'global', transactionId, transactionData)

    logger.info('[process_payment] Transaction recorded', {
      transaction_id: transactionId,
      payment_intent_id: paymentIntent.id,
      status: paymentIntent.status,
      duration_ms: Date.now() - startTime,
    })

    const result: ProcessPaymentOutput['result'] = {
      payment_intent_id: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      customer_id: customerId,
      transaction_id: transactionId,
      created_at: now,
    }

    // Include client secret if payment requires action
    if (paymentIntent.client_secret) {
      result.client_secret = paymentIntent.client_secret
    }

    // Include action details if payment requires additional action (e.g., 3D Secure)
    if (paymentIntent.status === 'requires_action' && paymentIntent.next_action) {
      result.requires_action = true
      result.next_action = {
        type: paymentIntent.next_action.type,
        url: (paymentIntent.next_action as any).redirect_to_url?.url,
      }
    }

    return {
      success: true,
      result,
    }
  } catch (error) {
    const duration = Date.now() - startTime

    logger.error('[process_payment] Payment processing failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: duration,
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
