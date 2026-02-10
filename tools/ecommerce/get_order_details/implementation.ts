import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getData } from '@/lib/data-layer'
import { logger } from '@/lib/observability/logger'

interface OrderItem {
  product_id: string
  name: string
  quantity: number
  price: number
  total: number
  product_details?: Record<string, any>
}

interface GetOrderDetailsInput {
  order_id?: string
  order_number?: string
  include_product_details?: boolean
}

interface GetOrderDetailsOutput {
  success: boolean
  order_id?: string
  order_number?: string
  status?: string
  customer_name?: string
  customer_email?: string
  items?: OrderItem[]
  item_count?: number
  subtotal?: number
  tax_amount?: number
  shipping_amount?: number
  discount_amount?: number
  total_amount?: number
  currency?: string
  shipping_address?: Record<string, any>
  billing_address?: Record<string, any>
  created_at?: string
  updated_at?: string
  error?: string
}

/**
 * Retrieve complete order details
 *
 * Fetches full order information including line items, customer data,
 * addresses, and financial summary. Supports lookup by order_id or
 * order_number. Optionally includes detailed product information.
 *
 * @param input - Order lookup parameters
 * @param context - Tool context for data layer access
 * @returns Complete order details with all related information
 */
export default async function getOrderDetails(
  input: GetOrderDetailsInput,
  context: ToolContext
): Promise<GetOrderDetailsOutput> {
  try {
    logger.info('Fetching order details', {
      order_id: input.order_id,
      order_number: input.order_number,
    })

    if (!input.order_id && !input.order_number) {
      return {
        success: false,
        error: 'Either order_id or order_number must be provided',
      }
    }

    const dataLayer = getData(context)
    const tenantId = context.tenantId || 'default'

    let order = null

    // Find order by ID
    if (input.order_id) {
      try {
        order = await dataLayer.read('orders', tenantId, input.order_id)
      } catch (error) {
        logger.warn('Order not found by ID', { order_id: input.order_id })
      }
    }

    // If not found by ID, search by order_number
    if (!order && input.order_number) {
      try {
        const orders = await dataLayer.list('orders', tenantId)
        if (Array.isArray(orders)) {
          order = orders.find((o) => o.order_number === input.order_number)
        }
      } catch (error) {
        logger.warn('Error searching orders by number', { order_number: input.order_number })
      }
    }

    if (!order) {
      return {
        success: false,
        error: `Order not found: ${input.order_id || input.order_number}`,
      }
    }

    logger.info('Order found', {
      order_id: order.id,
      order_number: order.order_number,
      customer_email: order.customer_email,
    })

    // Fetch product details if requested
    let items = order.items || []

    if (input.include_product_details && Array.isArray(items)) {
      const itemsWithDetails = await Promise.all(
        items.map(async (item) => {
          try {
            const product = await dataLayer.read('products', tenantId, item.product_id)
            return {
              ...item,
              product_details: product || null,
            }
          } catch (error) {
            logger.warn('Could not fetch product details', { product_id: item.product_id })
            return item
          }
        })
      )
      items = itemsWithDetails
    }

    logger.info('Order details retrieved', {
      order_id: order.id,
      items_count: items.length,
      total_amount: order.total_amount,
    })

    return {
      success: true,
      order_id: order.id,
      order_number: order.order_number,
      status: order.status,
      customer_name: order.customer_name,
      customer_email: order.customer_email,
      items: items as OrderItem[],
      item_count: items.length,
      subtotal: order.subtotal || 0,
      tax_amount: order.tax_amount || 0,
      shipping_amount: order.shipping_amount || 0,
      discount_amount: order.discount_amount || 0,
      total_amount: order.total_amount || 0,
      currency: order.currency || 'USD',
      shipping_address: order.shipping_address || {},
      billing_address: order.billing_address || {},
      created_at: order.created_at,
      updated_at: order.updated_at,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Failed to retrieve order details', { error: errorMessage })

    return {
      success: false,
      error: errorMessage,
    }
  }
}
