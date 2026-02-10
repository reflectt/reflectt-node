# Payment Tools Integration Guide

Quick reference for integrating the 5 payment tools into your application.

## Tool Locations

```
/tools/payment/
├── process_payment/
│   ├── definition.json        # Tool schema
│   └── implementation.ts       # Implementation
├── create_invoice/
│   ├── definition.json
│   └── implementation.ts
├── refund_payment/
│   ├── definition.json
│   └── implementation.ts
├── get_payment_status/
│   ├── definition.json
│   └── implementation.ts
└── list_transactions/
    ├── definition.json
    └── implementation.ts
```

## Step 1: Build Tool Registry

```bash
npm run build:tool-registry
```

This scans `/tools/` and updates:
- `lib/portals/generated/tool-registry.ts`
- `lib/portals/generated/tool-loaders.ts`

## Step 2: Deploy Database Schema

```bash
# Option A: Use Supabase CLI
supabase db push

# Option B: Manual SQL
psql your-db-url < supabase/schemas/transactions.sql
```

This creates:
- `transactions` table
- 11 indexes
- 4 helper functions
- RLS policies

## Step 3: Configure Environment

```bash
# .env.local
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx  # Optional
STRIPE_WEBHOOK_SECRET=whsec_xxxxx     # Optional (for webhooks)
```

## Step 4: Call Tools from Agent

### In Agent System Prompts

```typescript
// lib/agents/payment-processor.ts
export const paymentProcessorAgent = {
  slug: 'payment_processor',
  name: 'Payment Processor',
  description: 'Handles payment processing and invoicing',
  system_prompt: `
You are a payment processor. You can:
- Process payments with process_payment
- Create invoices with create_invoice
- Refund payments with refund_payment
- Check payment status with get_payment_status
- View transaction history with list_transactions

When processing payments:
1. Validate amount and currency
2. Create payment intent with idempotency key
3. Handle 3D Secure if needed
4. Return transaction ID to user

When creating invoices:
1. Validate line items
2. Set appropriate due date
3. Provide invoice URL to customer

When refunding:
1. Verify original transaction
2. Confirm refund amount
3. Document reason
4. Return confirmation

Always use structured logging for audit trails.
  `,
  model: 'claude-sonnet-4-20250514',
  temperature: 1.0,
}
```

### Direct Tool Execution

```typescript
// In any context where ToolContext is available
import type { ToolContext } from '@/lib/tools/helpers/tool-context'

export async function processPaymentFlow(
  amount: number,
  paymentMethodId: string,
  customerEmail: string,
  context: ToolContext
) {
  // Process payment
  const payment = await context.executeTool('process_payment', {
    amount,
    currency: 'usd',
    payment_method_id: paymentMethodId,
    customer_email: customerEmail,
    idempotency_key: `payment_${Date.now()}`
  })

  if (!payment.success) {
    throw new Error(`Payment failed: ${payment.error}`)
  }

  return {
    transactionId: payment.result.transaction_id,
    status: payment.result.status
  }
}
```

## Workflow Examples

### Complete Payment Workflow

```typescript
async function completePaymentWorkflow(
  customer: { email: string; name: string },
  items: Array<{ description: string; price: number }>,
  context: ToolContext
) {
  // Step 1: Create payment method (frontend handles this with Stripe.js)
  // const paymentMethod = await stripe.createPaymentMethod({...})

  // Step 2: Process payment
  const payment = await context.executeTool('process_payment', {
    amount: items.reduce((sum, item) => sum + item.price, 0),
    currency: 'usd',
    payment_method_id: 'pm_xxxxx',
    customer_email: customer.email,
    customer_name: customer.name,
    description: `Order for ${customer.name}`,
    metadata: {
      item_count: items.length,
      items_summary: items.map(i => i.description).join(', ')
    }
  })

  if (!payment.success) throw new Error(payment.error)

  // Step 3: Create invoice (optional)
  const invoice = await context.executeTool('create_invoice', {
    customer_id: payment.result.customer_id,
    items: items.map(item => ({
      name: item.description,
      amount: item.price
    })),
    description: `Invoice for ${customer.name}`,
    metadata: {
      payment_intent_id: payment.result.payment_intent_id,
      transaction_id: payment.result.transaction_id
    }
  })

  if (invoice.success) {
    // Send invoice URL to customer
    console.log(`Invoice: ${invoice.result.invoice_url}`)
  }

  return {
    transaction_id: payment.result.transaction_id,
    status: payment.result.status,
    invoice_url: invoice.result?.invoice_url
  }
}
```

### Refund Workflow

```typescript
async function processRefund(
  transactionId: string,
  reason: string,
  context: ToolContext
) {
  // Step 1: Check payment status
  const status = await context.executeTool('get_payment_status', {
    transaction_id: transactionId,
    include_refunds: true
  })

  if (!status.success) {
    throw new Error(`Transaction not found: ${transactionId}`)
  }

  if (status.result.status !== 'succeeded') {
    throw new Error(`Cannot refund non-succeeded transaction`)
  }

  // Step 2: Process refund
  const refund = await context.executeTool('refund_payment', {
    transaction_id: transactionId,
    reason: reason as any,
    metadata: {
      refund_date: new Date().toISOString(),
      initiated_by: context.userId
    }
  })

  if (!refund.success) {
    throw new Error(`Refund failed: ${refund.error}`)
  }

  return refund.result
}
```

### Analytics Workflow

```typescript
async function generateMonthlyReport(
  month: string,  // '2025-01'
  context: ToolContext
) {
  const [year, monthNum] = month.split('-')
  const startDate = `${year}-${monthNum}-01`
  const endDate = new Date(parseInt(year), parseInt(monthNum), 0)
    .toISOString()
    .split('T')[0]

  const result = await context.executeTool('list_transactions', {
    start_date: startDate,
    end_date: endDate,
    limit: 1000
  })

  if (!result.success) throw new Error(result.error)

  const { transactions, summary } = result.result

  return {
    month,
    totalRevenue: summary.total_amount / 100,
    transactionCount: summary.total_transactions,
    averageTransaction: summary.average_transaction / 100,
    succeeded: summary.by_status['succeeded'] || 0,
    refunded: summary.by_status['refunded'] || 0,
    failed: summary.by_status['failed'] || 0,
    transactions: transactions.slice(0, 10)
  }
}
```

## API Route Example

```typescript
// app/api/payments/process/route.ts
import { NextRequest, NextResponse } from 'next/server'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getData } from '@/lib/data-layer'
import { getUserContext } from '@/lib/auth/get-user-context'

export async function POST(request: NextRequest) {
  try {
    const { amount, paymentMethodId, customerEmail, customerName } = await request.json()

    // Get user context
    const userContext = await getUserContext(request)
    
    // Create tool context
    const context: ToolContext = {
      userId: userContext.userId,
      tenantId: userContext.tenantId,
      spaceId: userContext.spaceId,
      executeTool: executeToolFromContext,
    }

    // Process payment
    const result = await context.executeTool('process_payment', {
      amount,
      currency: 'usd',
      payment_method_id: paymentMethodId,
      customer_email: customerEmail,
      customer_name: customerName
    })

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      )
    }

    return NextResponse.json(result.result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
```

## Frontend Integration

### React Hook Example

```typescript
// hooks/use-payment.ts
import { useState } from 'react'

export function usePayment() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const processPayment = async (
    amount: number,
    paymentMethodId: string,
    customerEmail: string
  ) => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/payments/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          paymentMethodId,
          customerEmail
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Payment failed')
      }

      return {
        success: true,
        transactionId: data.transaction_id,
        status: data.status
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(message)
      return { success: false, error: message }
    } finally {
      setLoading(false)
    }
  }

  return { processPayment, loading, error }
}
```

## Database Queries

### Get Transaction Summary

```sql
SELECT * FROM get_transaction_summary(
  p_tenant_id := 'space_123',
  p_start_date := '2025-01-01'::timestamptz,
  p_end_date := '2025-01-31'::timestamptz
);
```

### Get Customer Transactions

```sql
SELECT * FROM get_customer_transactions('cus_1234567890', p_limit := 50);
```

### Get Refunds for Transaction

```sql
SELECT * FROM get_transaction_refunds('transaction-uuid'::uuid);
```

### Get Daily Totals

```sql
SELECT * FROM get_daily_transaction_totals(
  p_tenant_id := 'space_123',
  p_days := 30
);
```

## Error Handling

```typescript
// Common error scenarios

// 1. Missing Stripe key
// Error: STRIPE_SECRET_KEY environment variable is not set

// 2. Invalid payment method
// Error: Payment method not found or invalid

// 3. Insufficient funds
// Error: Your card has insufficient funds

// 4. Transaction not found
// Error: Transaction not found in database

// 5. Cannot refund non-succeeded
// Error: Cannot refund non-succeeded transaction

// Always handle with try/catch and return user-friendly messages
try {
  const result = await context.executeTool('process_payment', {...})
  if (!result.success) {
    // Return user-friendly error message
    return { error: 'Payment processing failed. Please try again.' }
  }
} catch (error) {
  logger.error('Payment error', error)
  return { error: 'An unexpected error occurred.' }
}
```

## Testing

### Unit Test Example

```typescript
// tests/unit/payment/process_payment.test.ts
import { describe, it, expect, vi } from 'vitest'
import process_payment from '@/tools/payment/process_payment/implementation'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'

describe('process_payment', () => {
  it('should process payment successfully', async () => {
    const context: ToolContext = {
      userId: 'user_123',
      tenantId: 'space_123',
      spaceId: 'space_123',
      executeTool: vi.fn(),
    }

    const result = await process_payment(
      {
        amount: 5000,
        currency: 'usd',
        payment_method_id: 'pm_test',
        customer_email: 'test@example.com'
      },
      context
    )

    expect(result.success).toBe(true)
    expect(result.result?.payment_intent_id).toBeDefined()
    expect(result.result?.transaction_id).toBeDefined()
  })
})
```

## Deployment Checklist

- [ ] Set `STRIPE_SECRET_KEY` in production environment
- [ ] Run `npm run build:tool-registry`
- [ ] Deploy database schema: `supabase db push`
- [ ] Test payment flow in staging
- [ ] Enable Stripe webhook (optional)
- [ ] Monitor tool logs for errors
- [ ] Set up alerts for failed transactions

## Support & Debugging

- Check tool logs: `logger.info/error` in implementation
- Query transactions table directly for audit trails
- Use Stripe Dashboard to verify charges
- Check RLS policies if access denied
- Verify ToolContext is properly passed to tools

For detailed documentation, see `/lib/integrations/payment/README.md`
