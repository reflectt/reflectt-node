# E-Commerce Tools - Shopify Integration

Complete set of production-ready e-commerce tools for managing products, orders, and inventory with Shopify integration.

## Overview

The e-commerce toolset provides 5 core tools for Shopify-based store management:

1. **sync_products** - Synchronize products from Shopify to database
2. **create_order** - Create orders with automatic inventory updates
3. **update_inventory** - Manage inventory levels with low-stock alerts
4. **get_order_details** - Retrieve complete order information
5. **sync_shopify_data** - Comprehensive data synchronization (products, orders, inventory)

## Tools

### 1. sync_products

Fetches products from Shopify API and stores them in the products table.

**Features:**
- Filter by category and status (active/archived/draft)
- Automatic product creation/update
- Shopify metadata preservation
- Variant and inventory tracking
- Image handling with alt text

**Parameters:**
- `category` (string, optional) - Filter by product category
- `status` (string, optional) - Filter by status (active|archived|draft)
- `limit` (integer, optional) - Max products to sync (1-250, default 50)
- `force_refresh` (boolean, optional) - Bypass cache

**Returns:**
```typescript
{
  success: boolean
  synced_count: number
  created_count: number
  updated_count: number
  skipped_count: number
  errors: Array<{ product_id: string; error: string }>
  summary: string
}
```

**Example Usage:**
```typescript
// Sync all active products
await context.executeTool('sync_products', {
  status: 'active',
  limit: 100
})

// Sync specific category
await context.executeTool('sync_products', {
  category: 'Electronics',
  force_refresh: true
})
```

**Implementation Details:**
- Uses `ShopifyClient.getProducts()`
- Stores in `products` table with tenant isolation
- Auto-updates existing products by Shopify ID
- Preserves Shopify metadata in JSON fields

---

### 2. create_order

Creates a new order with line items, customer info, and automatic inventory deduction.

**Features:**
- Accepts multiple line items with product IDs and quantities
- Auto-generates order numbers
- Automatic inventory reduction
- Low-stock alert generation
- Optional Shopify sync
- Support for discounts, taxes, and shipping

**Parameters:**
- `items` (array, required) - Line items [{product_id, quantity}, ...]
- `customer_name` (string, required) - Customer full name
- `customer_email` (string, required) - Customer email
- `shipping_address` (object, required) - {street, city, state, postal_code, country, phone}
- `billing_address` (object, optional) - Defaults to shipping address
- `tax_amount` (number, optional) - Tax (default 0)
- `shipping_amount` (number, optional) - Shipping cost (default 0)
- `discount_amount` (number, optional) - Discount (default 0)
- `notes` (string, optional) - Internal notes
- `sync_to_shopify` (boolean, optional) - Sync to Shopify

**Returns:**
```typescript
{
  success: boolean
  order_id?: string
  order_number?: string
  total_amount?: number
  items_count?: number
  error?: string
}
```

**Example Usage:**
```typescript
await context.executeTool('create_order', {
  items: [
    { product_id: '550e8400-e29b-41d4-a716-446655440000', quantity: 2 },
    { product_id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8', quantity: 1 }
  ],
  customer_name: 'John Doe',
  customer_email: 'john@example.com',
  shipping_address: {
    street: '123 Main St',
    city: 'New York',
    state: 'NY',
    postal_code: '10001',
    country: 'US'
  },
  tax_amount: 25.50,
  shipping_amount: 10.00,
  sync_to_shopify: true
})
```

**Implementation Details:**
- Uses data layer for order storage
- Automatically updates product inventory
- Generates order number: `ORD-YYYYMMDD-XXXXX`
- Triggers low-stock alerts
- Validates product existence before order creation

---

### 3. update_inventory

Updates product inventory with support for set/add/subtract operations.

**Features:**
- Look up by product ID or SKU
- Three operation types: set, add, subtract
- Automatic low-stock alert generation
- Optional Shopify sync
- Configurable threshold updates

**Parameters:**
- `product_id` (string, optional) - UUID of product
- `sku` (string, optional) - SKU of product (required if product_id not provided)
- `quantity` (integer, required) - Quantity to adjust (0+)
- `operation` (string, required) - set|add|subtract
- `low_stock_threshold` (integer, optional) - Update threshold
- `sync_to_shopify` (boolean, optional) - Sync to Shopify

**Returns:**
```typescript
{
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
```

**Example Usage:**
```typescript
// Set exact quantity
await context.executeTool('update_inventory', {
  product_id: '550e8400-e29b-41d4-a716-446655440000',
  quantity: 100,
  operation: 'set'
})

// Add to stock
await context.executeTool('update_inventory', {
  sku: 'SKU-12345',
  quantity: 50,
  operation: 'add',
  low_stock_threshold: 20
})

// Subtract from stock
await context.executeTool('update_inventory', {
  product_id: '550e8400-e29b-41d4-a716-446655440000',
  quantity: 5,
  operation: 'subtract'
})
```

**Implementation Details:**
- Finds product by ID first, then SKU
- Prevents negative stock (subtract floors at 0)
- Logs low-stock alerts when below threshold
- Supports threshold updates in same operation

---

### 4. get_order_details

Retrieves complete order information including items, customer data, and financials.

**Features:**
- Look up by order ID or order number
- Includes all line items with product info
- Full customer and address details
- Financial breakdown (subtotal, tax, shipping, discount)
- Optional product detail expansion

**Parameters:**
- `order_id` (string, optional) - UUID of order
- `order_number` (string, optional) - Order number (required if order_id not provided)
- `include_product_details` (boolean, optional) - Include full product info

**Returns:**
```typescript
{
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
  shipping_address?: object
  billing_address?: object
  created_at?: string
  updated_at?: string
  error?: string
}
```

**Example Usage:**
```typescript
// Look up by order ID
await context.executeTool('get_order_details', {
  order_id: '550e8400-e29b-41d4-a716-446655440000'
})

// Look up by order number with product details
await context.executeTool('get_order_details', {
  order_number: 'ORD-20251109-XXXXX',
  include_product_details: true
})
```

**Implementation Details:**
- Searches by ID first, then order number
- Optionally expands product details from database
- Returns all financial details
- Supports both lookup methods

---

### 5. sync_shopify_data

Comprehensive synchronization tool for products, orders, and inventory.

**Features:**
- Selective sync by data type (products|orders|inventory|all)
- Batch processing with configurable limits
- Detailed statistics per sync type
- Error tracking and reporting
- Cache bypass option

**Parameters:**
- `data_type` (string, optional) - products|orders|inventory|all (default: all)
- `limit` (integer, optional) - Max items per type (default 100, max 250)
- `force_refresh` (boolean, optional) - Bypass cache

**Returns:**
```typescript
{
  success: boolean
  products?: { created: number; updated: number; deleted: number; errors: number; duration_ms: number }
  orders?: { created: number; updated: number; deleted: number; errors: number; duration_ms: number }
  inventory?: { created: number; updated: number; deleted: number; errors: number; duration_ms: number }
  total_synced?: number
  total_errors?: number
  summary: string
}
```

**Example Usage:**
```typescript
// Sync everything
await context.executeTool('sync_shopify_data', {
  data_type: 'all',
  limit: 100
})

// Sync only products
await context.executeTool('sync_shopify_data', {
  data_type: 'products',
  force_refresh: true
})

// Sync inventory with cache bypass
await context.executeTool('sync_shopify_data', {
  data_type: 'inventory',
  limit: 50,
  force_refresh: true
})
```

**Implementation Details:**
- Processes each data type independently
- Uses ShopifyClient for data retrieval
- Handles create/update logic per type
- Comprehensive error tracking
- Returns timing information

## Configuration

### Environment Variables

```bash
# Shopify credentials (required for all tools)
SHOPIFY_STORE_NAME=mystore          # Shop domain
SHOPIFY_ACCESS_TOKEN=shpat_xxx      # Admin API access token

# Data layer configuration
DATA_BACKEND=database               # filesystem|database|both
NEXT_PUBLIC_SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=xxx
```

### Database Setup

The tools use two main tables:

**Products Table:**
- `id` - UUID primary key
- `tenant_id` - Multi-tenant isolation
- `shopify_product_id` - Shopify reference
- `sku`, `barcode` - Product identifiers
- `name`, `description` - Product details
- `price`, `currency` - Pricing
- `stock_quantity`, `low_stock_threshold` - Inventory
- `images`, `variants` - JSONB arrays
- `metadata` - Extended attributes

**Orders Table:**
- `id` - UUID primary key
- `tenant_id` - Multi-tenant isolation
- `order_number` - Auto-generated human-readable ID
- `status` - pending|confirmed|processing|shipped|delivered|cancelled|refunded
- `items` - JSONB array of line items
- `subtotal`, `tax_amount`, `shipping_amount`, `discount_amount`, `total_amount`
- `customer_name`, `customer_email`
- `shipping_address`, `billing_address` - JSONB

See `/supabase/schemas/products.sql` and `/supabase/schemas/orders.sql` for full schema.

## Usage Patterns

### Complete Order Flow

```typescript
// 1. Sync products from Shopify
const syncResult = await context.executeTool('sync_products', {
  status: 'active'
})

// 2. Create an order
const orderResult = await context.executeTool('create_order', {
  items: [{ product_id: productId, quantity: 2 }],
  customer_name: 'Jane Doe',
  customer_email: 'jane@example.com',
  shipping_address: { ... },
  sync_to_shopify: true
})

// 3. Check order details
const order = await context.executeTool('get_order_details', {
  order_id: orderResult.order_id
})

// 4. Update inventory for restocking
await context.executeTool('update_inventory', {
  product_id: productId,
  quantity: 50,
  operation: 'add'
})
```

### Inventory Management

```typescript
// Check for low stock
const products = await context.executeTool('sync_products', {
  limit: 250
})

// Update threshold for specific product
await context.executeTool('update_inventory', {
  sku: 'CRITICAL-SKU',
  quantity: 0,  // Keep current
  operation: 'set',
  low_stock_threshold: 50  // Alert when below 50
})
```

### Full Sync Process

```typescript
// Comprehensive sync of all Shopify data
const fullSync = await context.executeTool('sync_shopify_data', {
  data_type: 'all',
  limit: 250,
  force_refresh: true  // Bypass cache
})

// Check results
console.log(`Synced ${fullSync.total_synced} items`)
console.log(`Errors: ${fullSync.total_errors}`)
```

## Architecture Notes

### ToolContext Pattern

All tools use the `ToolContext` pattern for bulletproof path resolution:

```typescript
export default async function myTool(
  input: MyInput,
  context: ToolContext
): Promise<MyOutput> {
  const dataLayer = getData(context)
  const tenantId = context.tenantId || 'default'
  const userId = context.userId || 'demo-user'

  // Use data layer for all database operations
}
```

### Data Layer Abstraction

Tools use the unified data layer abstraction (`getData()`) which supports:
- **Filesystem**: Local JSON storage
- **Database**: Supabase PostgreSQL
- **Hybrid**: Dual-write with fallback reads

No direct database access - all operations go through the abstraction layer.

### Error Handling

All tools include comprehensive error handling:
- Validation of input parameters
- Graceful degradation on missing data
- Detailed error messages and logging
- Structured logging with context

## File Structure

```
tools/ecommerce/
├── README.md                          # This file
├── sync_products/
│   ├── definition.json               # Tool schema (name, parameters)
│   └── implementation.ts             # Tool logic (215 lines)
├── create_order/
│   ├── definition.json
│   └── implementation.ts             # (211 lines)
├── update_inventory/
│   ├── definition.json
│   └── implementation.ts             # (175 lines)
├── get_order_details/
│   ├── definition.json
│   └── implementation.ts             # (165 lines)
└── sync_shopify_data/
    ├── definition.json
    └── implementation.ts             # (307 lines)
```

**Total:** 1,073 lines of implementation code

## Testing

Each tool should be tested with:

```bash
# Test individual tool
npx tsx scripts/testing/test-ecommerce-tools.ts

# Test sync_products
npx tsx tools/ecommerce/sync_products/test.ts

# Test create_order
npx tsx tools/ecommerce/create_order/test.ts
```

## Future Enhancements

- [ ] Webhook handlers for real-time Shopify updates
- [ ] Batch order creation with CSV import
- [ ] Inventory forecasting and auto-reorder
- [ ] Customer data synchronization
- [ ] Return and refund management
- [ ] Multi-location inventory tracking
- [ ] Variant selection and SKU mapping
- [ ] Order fulfillment tracking

## Security Notes

- All tools respect Row Level Security (RLS) policies
- Multi-tenant isolation via `tenant_id`
- Shopify API credentials stored in environment variables
- No sensitive data logged (tokens, API keys)
- Service role key usage logged for audit trail

## Related Documentation

- **Shopify Integration:** `/lib/integrations/ecommerce/README.md`
- **Data Layer:** `/lib/data-layer/README.md`
- **Tool System:** `/lib/tools/helpers/README.md`
- **Database Schemas:** `/supabase/schemas/products.sql`, `/supabase/schemas/orders.sql`
- **API Endpoints:** `/docs/api/endpoints.md`

---

**Created:** November 9, 2025
**Version:** 1.0.0
**Status:** Production Ready
