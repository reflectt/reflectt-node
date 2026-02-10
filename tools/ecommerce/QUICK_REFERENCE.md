# E-Commerce Tools - Quick Reference

## One-Minute Overview

5 Shopify integration tools for managing products and orders:

| Tool | Purpose | Key Input | Key Output |
|------|---------|-----------|-----------|
| `sync_products` | Import products | `status`, `limit` | `synced_count`, `created_count` |
| `create_order` | Create orders | `items[]`, `customer_*`, `address` | `order_id`, `order_number` |
| `update_inventory` | Manage stock | `product_id`, `quantity`, `operation` | `new_stock`, `low_stock_alert` |
| `get_order_details` | Fetch orders | `order_id` or `order_number` | Full order with items & totals |
| `sync_shopify_data` | Full sync | `data_type`, `limit` | Statistics per type |

## Common Tasks

### Sync Products from Shopify
```typescript
await context.executeTool('sync_products', {
  status: 'active',
  limit: 100
})
```

### Create an Order
```typescript
await context.executeTool('create_order', {
  items: [{ product_id: 'xxx-yyy', quantity: 2 }],
  customer_name: 'John Doe',
  customer_email: 'john@example.com',
  shipping_address: {
    street: '123 Main St',
    city: 'NYC',
    state: 'NY',
    postal_code: '10001',
    country: 'US'
  },
  tax_amount: 25.50,
  shipping_amount: 10.00
})
```

### Add Inventory
```typescript
await context.executeTool('update_inventory', {
  product_id: 'xxx-yyy',
  quantity: 50,
  operation: 'add'
})
```

### Get Order Info
```typescript
await context.executeTool('get_order_details', {
  order_id: 'xxx-yyy'
})
// OR
await context.executeTool('get_order_details', {
  order_number: 'ORD-20251109-XXXXX'
})
```

### Full Data Sync
```typescript
await context.executeTool('sync_shopify_data', {
  data_type: 'all',
  limit: 250
})
```

## Parameter Cheat Sheet

### sync_products
```json
{
  "category": "string?",
  "status": "active|archived|draft?",
  "limit": "1-250?",
  "force_refresh": "boolean?"
}
```

### create_order
```json
{
  "items": [{"product_id": "uuid", "quantity": "int"}],
  "customer_name": "string",
  "customer_email": "string",
  "shipping_address": {
    "street": "string",
    "city": "string",
    "state": "string",
    "postal_code": "string",
    "country": "string",
    "phone": "string?"
  },
  "billing_address": "object?",
  "tax_amount": "number?",
  "shipping_amount": "number?",
  "discount_amount": "number?",
  "notes": "string?",
  "sync_to_shopify": "boolean?"
}
```

### update_inventory
```json
{
  "product_id": "uuid?",
  "sku": "string?",
  "quantity": "int",
  "operation": "set|add|subtract",
  "low_stock_threshold": "int?",
  "sync_to_shopify": "boolean?"
}
```

### get_order_details
```json
{
  "order_id": "uuid?",
  "order_number": "string?",
  "include_product_details": "boolean?"
}
```

### sync_shopify_data
```json
{
  "data_type": "products|orders|inventory|all?",
  "limit": "1-250?",
  "force_refresh": "boolean?"
}
```

## Response Format

All tools return:
```typescript
{
  success: boolean,
  [tool-specific fields],
  error?: string  // Only if !success
}
```

## Environment Setup

```bash
SHOPIFY_STORE_NAME=mystore
SHOPIFY_ACCESS_TOKEN=shpat_xxx
DATA_BACKEND=database
NEXT_PUBLIC_SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=xxx
```

## File Locations

```
/tools/ecommerce/
├── sync_products/
│   ├── definition.json
│   └── implementation.ts
├── create_order/
├── update_inventory/
├── get_order_details/
├── sync_shopify_data/
└── README.md (full docs)
```

## Building & Testing

```bash
# Register tools
npm run build:tool-registry

# Run tests
npx tsx scripts/testing/test-ecommerce-tools.ts
```

## Key Concepts

### Inventory Operations
- **set** - Set exact quantity
- **add** - Increase by amount
- **subtract** - Decrease by amount (floors at 0)

### Order Status
- pending → confirmed → processing → shipped → delivered
- Can also be: cancelled, refunded

### Lookups
- Products: by ID or SKU
- Orders: by ID or order_number

### Low Stock Alerts
- Automatic when stock < threshold
- Default threshold: 10 units
- Logged as WARNING

## Quick Troubleshooting

| Issue | Solution |
|-------|----------|
| "Product not found" | Check product_id or sku exists |
| "Shopify credentials not configured" | Set SHOPIFY_STORE_NAME and SHOPIFY_ACCESS_TOKEN |
| "Data backend error" | Ensure DATA_BACKEND env var set |
| "No valid products" | Check status filter matches products in Shopify |
| "Low stock alert" | Stock is below threshold - increase quantity |

## Pro Tips

1. **Batch Operations** - Use `sync_shopify_data` for full sync instead of individual tool calls
2. **Caching** - Use `force_refresh: true` only when needed
3. **Inventory** - Always check `low_stock_alert` response for restocking needs
4. **SKU Lookup** - Faster than product_id for inventory updates
5. **Error Handling** - Always check `success` flag before using response data

## Next Features (Roadmap)

- [ ] Webhook handlers for real-time updates
- [ ] Batch CSV order import
- [ ] Refund/return management
- [ ] Multi-location inventory
- [ ] Order fulfillment tracking

---

See `README.md` for complete documentation
