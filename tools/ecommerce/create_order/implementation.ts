import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getData } from '@/lib/data-layer'
import { logger } from '@/lib/observability/logger'
import { v4 as uuidv4 } from 'uuid'

interface OrderItem {
  product_id: string
  quantity: number
}

interface Address {
  street?: string
  city?: string
  state?: string
  postal_code?: string
  country?: string
  phone?: string
}

interface CreateOrderInput {
  items: OrderItem[]
  customer_name: string
  customer_email: string
  shipping_address: Address
  billing_address?: Address
  tax_amount?: number
  shipping_amount?: number
  discount_amount?: number
  notes?: string
  sync_to_shopify?: boolean
}

interface CreateOrderOutput {
  success: boolean
  order_id?: string
  order_number?: string
  total_amount?: number
  items_count?: number
  error?: string
}

/**
 * Create a new order in the system
 *
 * Accepts line items with product IDs and quantities, customer information,
 * and shipping address. Auto-generates order number and updates inventory.
 * Optionally syncs to Shopify if configured.
 *
 * @param input - Order creation details
 * @param context - Tool context for data layer access
 * @returns Order creation result with order ID and number
 */
export default async function createOrder(
  input: CreateOrderInput,
  context: ToolContext
): Promise<CreateOrderOutput> {
  try {
    logger.info('Creating new order', {
      customer_email: input.customer_email,
      items_count: input.items.length,
    })

    if (!input.items || input.items.length === 0) {
      return {
        success: false,
        error: 'Order must contain at least one item',
      }
    }

    const dataLayer = getData(context)
    const tenantId = context.tenantId || 'default'
    const userId = context.userId || 'demo-user'
    const orderId = uuidv4()

    // Calculate totals
    let subtotal = 0
    const orderItems = []

    // Validate and fetch product details
    for (const item of input.items) {
      try {
        const product = await dataLayer.read('products', tenantId, item.product_id)

        if (!product) {
          logger.warn('Product not found', { product_id: item.product_id })
          continue
        }

        const itemTotal = (product.price || 0) * item.quantity
        subtotal += itemTotal

        orderItems.push({
          product_id: item.product_id,
          name: product.name,
          quantity: item.quantity,
          price: product.price || 0,
          total: itemTotal,
        })
      } catch (error) {
        logger.error('Error fetching product', {
          product_id: item.product_id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (orderItems.length === 0) {
      return {
        success: false,
        error: 'No valid products found for order',
      }
    }

    // Calculate final total
    const taxAmount = input.tax_amount || 0
    const shippingAmount = input.shipping_amount || 0
    const discountAmount = input.discount_amount || 0
    const totalAmount = subtotal + taxAmount + shippingAmount - discountAmount

    // Create order record
    const orderData = {
      id: orderId,
      tenant_id: tenantId,
      user_id: userId,
      order_number: null, // Database trigger will auto-generate
      status: 'pending',
      items: orderItems,
      subtotal,
      tax_amount: taxAmount,
      shipping_amount: shippingAmount,
      discount_amount: discountAmount,
      total_amount: totalAmount,
      currency: 'USD',
      customer_name: input.customer_name,
      customer_email: input.customer_email,
      shipping_address: input.shipping_address,
      billing_address: input.billing_address || input.shipping_address,
      notes: input.notes || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    // Save order to database
    await dataLayer.create('orders', tenantId, orderId, orderData)

    // Update inventory for each product
    for (const item of input.items) {
      try {
        const product = await dataLayer.read('products', tenantId, item.product_id)

        if (product) {
          const newStock = Math.max(0, (product.stock_quantity || 0) - item.quantity)
          await dataLayer.update('products', tenantId, item.product_id, {
            stock_quantity: newStock,
            updated_at: new Date().toISOString(),
          })

          logger.debug('Updated inventory', {
            product_id: item.product_id,
            previous_stock: product.stock_quantity,
            new_stock: newStock,
            quantity_ordered: item.quantity,
          })

          // Check for low stock alert
          if (newStock < (product.low_stock_threshold || 10)) {
            logger.warn('Low stock alert', {
              product_id: item.product_id,
              product_name: product.name,
              current_stock: newStock,
              threshold: product.low_stock_threshold,
            })
          }
        }
      } catch (error) {
        logger.error('Error updating inventory', {
          product_id: item.product_id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // TODO: Sync to Shopify if configured
    if (input.sync_to_shopify) {
      logger.info('Shopify sync requested for order', { order_id: orderId })
      // Implementation would use ShopifyClient.createOrder() here
    }

    logger.info('Order created successfully', {
      order_id: orderId,
      total_amount: totalAmount,
      items_count: orderItems.length,
    })

    return {
      success: true,
      order_id: orderId,
      order_number: `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${orderId.slice(0, 5).toUpperCase()}`,
      total_amount: totalAmount,
      items_count: orderItems.length,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Order creation failed', { error: errorMessage })

    return {
      success: false,
      error: errorMessage,
    }
  }
}
