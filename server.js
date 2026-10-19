'use strict';

require('dotenv').config();
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const { all, get, create, update, remove, initializeDatabase } = require('./db');

const app = express();
const port = Number(process.env.PORT) || 3000;
const frontendDirectory = path.resolve(__dirname, '..', 'frontend');
const allowedOrigins = (process.env.CORS_ORIGIN || '*')
  .split(',').map(origin => origin.trim()).filter(Boolean);

// Permit configured browser origins, allow server-to-server requests, and answer preflights.
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  }
}));
app.use(express.json({ limit: '32kb' }));

const categories = new Set(['Clothing', 'Footwear', 'Electronics']);

function parseId(value) {
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// The API requires name, description and price; remaining fields support the supplied UI.
function validateProduct(body, products = [], currentId = null) {
  const errors = {};
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const sku = typeof input.sku === 'string' ? input.sku.trim() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const category = typeof input.category === 'string' ? input.category.trim() : 'Electronics';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const price = input.price === '' || input.price === null || input.price === undefined ? Number.NaN : Number(input.price);
  const stockQuantity = input.stock_quantity === undefined ? 0 : Number(input.stock_quantity);

  if (name.length < 1 || name.length > 100) errors.name = 'Name is required and must be 100 characters or fewer.';
  if (typeof input.description !== 'string' || description.length === 0 || description.length > 1000) {
    errors.description = 'Description is required and must be 1,000 characters or fewer.';
  }
  if (!Number.isFinite(price) || price < 0 || price > 1000000000) errors.price = 'Price must be a valid non-negative number.';
  if (input.category !== undefined && !categories.has(category)) errors.category = 'Choose Clothing, Footwear or Electronics.';
  if (!Number.isSafeInteger(stockQuantity) || stockQuantity < 0) errors.stock_quantity = 'Stock quantity must be a non-negative whole number.';
  if (sku && !/^[A-Za-z0-9-]{3,30}$/.test(sku)) errors.sku = 'SKU must be 3–30 letters, numbers or hyphens.';
  if (sku && products.some(product => product.sku === sku && product.id !== currentId)) {
    errors.sku = 'A product with that SKU already exists.';
  }

  return { errors, product: { sku, name, category, description, price, stock_quantity: stockQuantity } };
}

// Health check for deployment monitoring and quick local verification.
app.get('/api/health', (request, response) => {
  response.status(200).json({ status: 'ok', service: 'Elite Merchandise Traders Inventory API' });
});

// GET /api/products supports optional search and category filters.
app.get('/api/products', async (request, response) => {
  try {
    const search = typeof request.query.search === 'string' ? request.query.search.trim().toLowerCase() : '';
    const category = typeof request.query.category === 'string' ? request.query.category.trim() : '';
    let products = await all();
    if (search) products = products.filter(product => [product.sku, product.name, product.description]
      .some(value => String(value || '').toLowerCase().includes(search)));
    if (category && categories.has(category)) products = products.filter(product => product.category === category);
    products.sort((first, second) => second.id - first.id);
    return response.status(200).json({ count: products.length, products });
  } catch (error) {
    console.error('Product list failed:', error);
    return response.status(500).json({ error: 'An unexpected server error occurred.' });
  }
});

// GET /api/products/:id returns one product or a clear 404 response.
app.get('/api/products/:id', async (request, response) => {
  const id = parseId(request.params.id);
  if (!id) return response.status(400).json({ error: 'Product id must be a positive integer.' });
  try {
    const product = await get(id);
    if (!product) return response.status(404).json({ error: 'Product not found.' });
    return response.status(200).json({ product });
  } catch (error) {
    console.error('Product lookup failed:', error);
    return response.status(500).json({ error: 'An unexpected server error occurred.' });
  }
});

// POST /api/products validates required fields and responds with the created product.
app.post('/api/products', async (request, response) => {
  try {
    const products = await all();
    const { errors, product } = validateProduct(request.body, products);
    if (Object.keys(errors).length) return response.status(400).json({ error: 'Please correct the product details.', details: errors });
    const nextId = products.reduce((highest, item) => Math.max(highest, item.id), 0) + 1;
    if (!product.sku) product.sku = `EMT-PR-${String(nextId).padStart(3, '0')}`;
    const created = await create(product);
    return response.status(201).json({ message: 'Product created successfully.', product: created });
  } catch (error) {
    console.error('Product creation failed:', error);
    return response.status(500).json({ error: 'An unexpected server error occurred.' });
  }
});

// PUT /api/products/:id replaces all writable fields and refreshes updated_at.
app.put('/api/products/:id', async (request, response) => {
  const id = parseId(request.params.id);
  if (!id) return response.status(400).json({ error: 'Product id must be a positive integer.' });
  try {
    const products = await all();
    if (!products.some(product => product.id === id)) return response.status(404).json({ error: 'Product not found.' });
    const { errors, product } = validateProduct(request.body, products, id);
    if (Object.keys(errors).length) return response.status(400).json({ error: 'Please correct the product details.', details: errors });
    if (!product.sku) product.sku = products.find(item => item.id === id).sku;
    const updated = await update(id, product);
    return response.status(200).json({ message: 'Product updated successfully.', product: updated });
  } catch (error) {
    console.error('Product update failed:', error);
    return response.status(500).json({ error: 'An unexpected server error occurred.' });
  }
});

// DELETE /api/products/:id removes a product or reports a missing ID as 404.
app.delete('/api/products/:id', async (request, response) => {
  const id = parseId(request.params.id);
  if (!id) return response.status(400).json({ error: 'Product id must be a positive integer.' });
  try {
    if (!await remove(id)) return response.status(404).json({ error: 'Product not found.' });
    return response.status(200).json({ message: 'Product deleted successfully.', id });
  } catch (error) {
    console.error('Product deletion failed:', error);
    return response.status(500).json({ error: 'An unexpected server error occurred.' });
  }
});

// Serve the plain HTML/CSS/JS client from the same origin as the API.
app.use(express.static(frontendDirectory));
app.use('/api', (request, response) => response.status(404).json({ error: 'API endpoint not found.' }));
app.use((request, response) => response.status(404).json({ error: 'Page not found.' }));

// Convert malformed JSON and unexpected middleware errors into JSON API responses.
app.use((error, request, response, next) => {
  if (response.headersSent) return next(error);
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return response.status(400).json({ error: 'Request body must contain valid JSON.' });
  }
  console.error('Request failed:', error);
  return response.status(500).json({ error: 'An unexpected server error occurred.' });
});

async function startServer() {
  try {
    await initializeDatabase();
    app.listen(port, '0.0.0.0', () => {
      console.info(`Elite Merchandise Traders app is running on port ${port}`);
    });
  } catch (error) {
    console.error('Unable to initialize the application:', error);
    process.exitCode = 1;
  }
}

if (require.main === module) startServer();
module.exports = { app, startServer };
