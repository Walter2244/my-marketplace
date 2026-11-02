// For the vendor who owns the product: adds inStock and keeps the exact quantity
function withStock(product) {
  return { ...product, inStock: product.quantity > 0 };
}

// For buyers: adds inStock, and replaces a zero quantity with null so buyers see "out of stock" rather than 0
function publicStock(product) {
  const inStock = product.quantity > 0;
  return { ...product, inStock, quantity: inStock ? product.quantity : null };
}

module.exports = { withStock, publicStock };
