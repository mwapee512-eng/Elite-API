'use strict';

require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');

const configuredPath = process.env.DATA_FILE || './data/products.json';
const dataPath = path.isAbsolute(configuredPath)
  ? configuredPath
  : path.resolve(__dirname, configuredPath);

const starterProducts = [
  ['EMT-CL-001', 'Classic Cotton T-Shirt', 'Clothing', 'Breathable everyday cotton tee in assorted colours.', 180, 24],
  ['EMT-CL-002', 'Smart Casual Shirt', 'Clothing', 'Long-sleeve button shirt suitable for campus and work.', 320, 12],
  ['EMT-CL-003', 'Everyday Denim Jeans', 'Clothing', 'Durable straight-fit denim for daily wear.', 450, 9],
  ['EMT-CL-004', 'Lightweight Hoodie', 'Clothing', 'Comfortable pullover hoodie for cool evenings.', 390, 15],
  ['EMT-FW-001', 'Classic Canvas Sneakers', 'Footwear', 'Versatile low-top canvas shoes for everyday use.', 520, 11],
  ['EMT-FW-002', 'Comfort Walking Shoes', 'Footwear', 'Cushioned walking shoes with a supportive sole.', 680, 7],
  ['EMT-FW-003', 'Formal Office Shoes', 'Footwear', 'Polished lace-up shoes for professional occasions.', 750, 5],
  ['EMT-EL-001', 'Wireless Bluetooth Earbuds', 'Electronics', 'Compact wireless earbuds with a charging case.', 420, 18],
  ['EMT-EL-002', 'Fast-Charge USB-C Adapter', 'Electronics', 'Reliable wall adapter for compatible USB-C devices.', 260, 22],
  ['EMT-EL-003', 'Portable Bluetooth Speaker', 'Electronics', 'Rechargeable portable speaker for music on the go.', 590, 8]
].map(([sku, name, category, description, price, stock_quantity], index) => {
  const timestamp = new Date().toISOString();
  return { id: index + 1, sku, name, category, description, price, stock_quantity, created_at: timestamp, updated_at: timestamp };
});

let writeQueue = Promise.resolve();

async function readProducts() {
  const contents = await fs.readFile(dataPath, 'utf8');
  const products = JSON.parse(contents);
  if (!Array.isArray(products)) throw new Error('Product data file must contain a JSON array.');
  return products;
}

async function writeProducts(products) {
  await fs.mkdir(path.dirname(dataPath), { recursive: true });
  const temporaryPath = `${dataPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(products, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, dataPath);
}

// Serialize changes to avoid lost updates when requests arrive close together.
function mutateProducts(mutator) {
  const operation = writeQueue.then(async () => {
    const products = await readProducts();
    const result = await mutator(products);
    await writeProducts(products);
    return result;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

async function initializeDatabase() {
  await fs.mkdir(path.dirname(dataPath), { recursive: true });
  try {
    await fs.access(dataPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeProducts(starterProducts);
    console.info('Created the JSON product store with ten starter products.');
  }
  await readProducts();
  console.info(`JSON product store ready at ${dataPath}`);
}

async function all() {
  return readProducts();
}

async function get(id) {
  return (await readProducts()).find(product => product.id === id) || null;
}

async function create(product) {
  return mutateProducts(products => {
    const id = products.reduce((highest, current) => Math.max(highest, current.id), 0) + 1;
    const timestamp = new Date().toISOString();
    const created = { id, ...product, created_at: timestamp, updated_at: timestamp };
    products.push(created);
    return created;
  });
}

async function update(id, product) {
  return mutateProducts(products => {
    const index = products.findIndex(item => item.id === id);
    if (index === -1) return null;
    products[index] = { ...products[index], ...product, id, updated_at: new Date().toISOString() };
    return products[index];
  });
}

async function remove(id) {
  return mutateProducts(products => {
    const index = products.findIndex(item => item.id === id);
    if (index === -1) return false;
    products.splice(index, 1);
    return true;
  });
}

module.exports = { all, get, create, update, remove, initializeDatabase };
