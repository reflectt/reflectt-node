import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getData } from '@/lib/data-layer'
import { logger } from '@/lib/observability/logger'

interface UpdateInventoryInput {
  product_id?: string
  sku?: string
  quantity: number
  operation: 'set' | 'add' | 'subtract'
  low_stock_threshold?: number
  sync_to_shopify?: boolean
}

interface UpdateInventoryOutput {
  success: boolean
  product_id?: string
  product_name?: string
  previous_stock?: number
  new_stock?: number
  operation?: string
  low_stock_alert?: boolean
  low_stock_threshold?: number
  units_needed?: number
  error?: string
}

/**
 * Update product inventory levels
 *
 * Accepts product_id or SKU to identify the product, quantity adjustment,
 * and operation type (set/add/subtract). Automatically checks for low stock
 * and generates alerts. Optionally syncs to Shopify if configured.
 *
 * @param input - Inventory update parameters
 * @param context - Tool context for data layer access
 * @returns Updated inventory status with alerts
 */
export default async function updateInventory(
  input: UpdateInventoryInput,
  context: ToolContext
): Promise<UpdateInventoryOutput> {
  try {
    logger.info('Updating inventory', {
      product_id: input.product_id,
      sku: input.sku,
      quantity: input.quantity,
      operation: input.operation,
    })

    if (!input.product_id && !input.sku) {
      return {
        success: false,
        error: 'Either product_id or sku must be provided',
      }
    }

    const dataLayer = getData(context)
    const tenantId = context.tenantId || 'default'

    // Find product by ID or SKU
    let product = null
    let productId = input.product_id

    if (input.product_id) {
      try {
        product = await dataLayer.read('products', tenantId, input.product_id)
        productId = input.product_id
      } catch (error) {
        logger.warn('Product not found by ID', { product_id: input.product_id })
      }
    }

    // If not found by ID, search by SKU
    if (!product && input.sku) {
      try {
        const products = await dataLayer.list('products', tenantId)
        if (Array.isArray(products)) {
          product = products.find(
            (p) => p.sku && p.sku.toLowerCase() === input.sku!.toLowerCase()
          )
          if (product) {
            productId = product.id
          }
        }
      } catch (error) {
        logger.warn('Error searching products by SKU', { sku: input.sku })
      }
    }

    if (!product) {
      return {
        success: false,
        error: `Product not found: ${input.product_id || input.sku}`,
      }
    }

    // Calculate new stock based on operation
    const previousStock = product.stock_quantity || 0
    let newStock = previousStock

    switch (input.operation) {
      case 'set':
        newStock = input.quantity
        break
      case 'add':
        newStock = previousStock + input.quantity
        break
      case 'subtract':
        newStock = Math.max(0, previousStock - input.quantity)
        break
    }

    // Update product with new stock and optional threshold
    const updates: any = {
      stock_quantity: newStock,
      updated_at: new Date().toISOString(),
    }

    if (input.low_stock_threshold !== undefined) {
      updates.low_stock_threshold = input.low_stock_threshold
    }

    await dataLayer.update('products', tenantId, productId, updates)

    // Check for low stock alert
    const threshold = input.low_stock_threshold ?? product.low_stock_threshold ?? 10
    const isLowStock = newStock < threshold
    const unitsNeeded = isLowStock ? threshold - newStock : 0

    logger.info('Inventory updated successfully', {
      product_id: productId,
      product_name: product.name,
      previous_stock: previousStock,
      new_stock: newStock,
      operation: input.operation,
      low_stock_alert: isLowStock,
    })

    if (isLowStock) {
      logger.warn('Low stock alert triggered', {
        product_id: productId,
        product_name: product.name,
        current_stock: newStock,
        threshold,
        units_needed: unitsNeeded,
      })
    }

    // TODO: Sync to Shopify if configured
    if (input.sync_to_shopify) {
      logger.info('Shopify sync requested for inventory', { product_id: productId })
      // Implementation would use ShopifyClient.updateInventory() here
    }

    return {
      success: true,
      product_id: productId,
      product_name: product.name,
      previous_stock: previousStock,
      new_stock: newStock,
      operation: input.operation,
      low_stock_alert: isLowStock,
      low_stock_threshold: threshold,
      units_needed: isLowStock ? unitsNeeded : 0,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Inventory update failed', { error: errorMessage })

    return {
      success: false,
      error: errorMessage,
    }
  }
}
