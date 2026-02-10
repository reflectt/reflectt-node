import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { ShopifyClient } from '@/lib/integrations/ecommerce/shopify-client'
import { getData } from '@/lib/data-layer'
import { logger } from '@/lib/observability/logger'
import { v4 as uuidv4 } from 'uuid'

interface SyncProductsInput {
  category?: string
  status?: 'active' | 'archived' | 'draft'
  limit?: number
  force_refresh?: boolean
}

interface SyncProductsOutput {
  success: boolean
  synced_count: number
  created_count: number
  updated_count: number
  skipped_count: number
  errors: Array<{
    product_id: string
    error: string
  }>
  summary: string
}

/**
 * Synchronize products from Shopify to database
 *
 * Fetches products from Shopify API, stores them in the products table.
 * Supports filtering by category and status. Returns count of synced products
 * with detailed breakdown of created, updated, and skipped items.
 *
 * @param input - Sync parameters with optional category/status filters
 * @param context - Tool context for data layer access
 * @returns Sync summary with counts and error details
 */
export default async function syncProducts(
  input: SyncProductsInput,
  context: ToolContext
): Promise<SyncProductsOutput> {
  const startTime = Date.now()
  let createdCount = 0
  let updatedCount = 0
  let skippedCount = 0
  const errors: Array<{ product_id: string; error: string }> = []

  try {
    logger.info('Starting product sync from Shopify', {
      category: input.category,
      status: input.status,
      limit: input.limit,
      force_refresh: input.force_refresh,
    })

    // Initialize Shopify client
    const shopName = process.env.SHOPIFY_STORE_NAME
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN

    if (!shopName || !accessToken) {
      throw new Error('Shopify credentials not configured (SHOPIFY_STORE_NAME, SHOPIFY_ACCESS_TOKEN)')
    }

    const shopifyClient = new ShopifyClient({
      shop: shopName,
      accessToken,
    })

    // Get products from Shopify
    const products = await shopifyClient.getProducts({
      limit: Math.min(input.limit || 50, 250),
    })

    if (!products || products.length === 0) {
      logger.warn('No products returned from Shopify')
      return {
        success: true,
        synced_count: 0,
        created_count: 0,
        updated_count: 0,
        skipped_count: 0,
        errors: [],
        summary: 'No products found in Shopify',
      }
    }

    // Get data layer for database operations
    const dataLayer = getData(context)
    const tenantId = context.tenantId || 'default'

    // Process each product
    for (const shopifyProduct of products) {
      try {
        // Apply filters
        if (input.category && !shopifyProduct.product_type?.includes(input.category)) {
          skippedCount++
          continue
        }

        if (input.status && shopifyProduct.status !== input.status) {
          skippedCount++
          continue
        }

        // Prepare product data for database
        const productData = {
          id: uuidv4(),
          tenant_id: tenantId,
          shopify_product_id: shopifyProduct.id,
          sku: shopifyProduct.variants?.[0]?.sku || shopifyProduct.handle,
          name: shopifyProduct.title,
          description: shopifyProduct.body_html,
          category: [shopifyProduct.product_type].filter(Boolean),
          tags: shopifyProduct.tags || [],
          price: parseFloat(shopifyProduct.variants?.[0]?.price || '0'),
          currency: 'USD',
          stock_quantity: shopifyProduct.variants?.[0]?.inventory_quantity || 0,
          images: shopifyProduct.images?.map((img) => ({
            url: img.src,
            alt_text: img.alt || '',
            primary: img.id === shopifyProduct.image?.id,
          })) || [],
          variants: shopifyProduct.variants?.map((variant) => ({
            name: variant.title,
            price: parseFloat(variant.price),
            sku: variant.sku,
            stock: variant.inventory_quantity,
          })) || [],
          is_active: shopifyProduct.status === 'active',
          metadata: {
            shopify_vendor: shopifyProduct.vendor,
            shopify_handle: shopifyProduct.handle,
            shopify_created_at: shopifyProduct.created_at,
            shopify_updated_at: shopifyProduct.updated_at,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }

        // Check if product already exists
        try {
          const existingProduct = await dataLayer.read('products', tenantId, shopifyProduct.id)

          if (existingProduct) {
            // Update existing product
            await dataLayer.update('products', tenantId, shopifyProduct.id, productData)
            updatedCount++
            logger.debug('Updated product', { product_id: shopifyProduct.id, name: shopifyProduct.title })
          } else {
            // Create new product
            await dataLayer.create('products', tenantId, shopifyProduct.id, productData)
            createdCount++
            logger.debug('Created product', { product_id: shopifyProduct.id, name: shopifyProduct.title })
          }
        } catch {
          // Product doesn't exist, create it
          await dataLayer.create('products', tenantId, shopifyProduct.id, productData)
          createdCount++
          logger.debug('Created product', { product_id: shopifyProduct.id, name: shopifyProduct.title })
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        errors.push({
          product_id: shopifyProduct.id,
          error: errorMessage,
        })
        logger.error('Error syncing product', {
          product_id: shopifyProduct.id,
          error: errorMessage,
        })
      }
    }

    const duration = Date.now() - startTime
    const syncedCount = createdCount + updatedCount

    logger.info('Product sync completed', {
      created: createdCount,
      updated: updatedCount,
      skipped: skippedCount,
      errors: errors.length,
      duration,
    })

    return {
      success: errors.length === 0,
      synced_count: syncedCount,
      created_count: createdCount,
      updated_count: updatedCount,
      skipped_count: skippedCount,
      errors,
      summary: `Synced ${syncedCount} products (${createdCount} created, ${updatedCount} updated, ${skippedCount} skipped)${
        errors.length > 0 ? ` with ${errors.length} errors` : ''
      }`,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Product sync failed', { error: errorMessage })

    return {
      success: false,
      synced_count: 0,
      created_count: 0,
      updated_count: 0,
      skipped_count: 0,
      errors: [
        {
          product_id: 'sync',
          error: errorMessage,
        },
      ],
      summary: `Product sync failed: ${errorMessage}`,
    }
  }
}
