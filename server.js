const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const JS_DIR = path.join(ROOT, "js");
const PORT = Number(process.env.PORT || 3000);

const DATA_FILES = {
  products: path.join(DATA_DIR, "products.json"),
  orders: path.join(DATA_DIR, "orders.json"),
  admin: path.join(DATA_DIR, "admin.json")
};

const DEFAULT_ADMIN = {
  id: "admin-1",
  username: "admin",
  password_hash: "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9",
  role: "superadmin",
  last_login: null
};

const sessions = new Map();

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function noContent(res) {
  res.writeHead(204);
  res.end();
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2 * 1024 * 1024) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(JS_DIR, { recursive: true });
  await ensureFile(DATA_FILES.products, []);
  await ensureFile(DATA_FILES.orders, []);
  await ensureFile(DATA_FILES.admin, DEFAULT_ADMIN);
}

async function ensureFile(filePath, fallback) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(fallback, null, 2), "utf8");
  }
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function getTokenFromRequest(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    return null;
  }
  return auth.slice(7);
}

async function requireAdmin(req) {
  const token = getTokenFromRequest(req);
  if (!token || !sessions.has(token)) {
    return null;
  }
  const session = sessions.get(token);
  const admin = await readJson(DATA_FILES.admin);
  if (admin.id !== session.adminId) {
    return null;
  }
  return admin;
}

function sanitizeProduct(input, existingId) {
  return {
    id: existingId || crypto.randomUUID(),
    name: String(input.name || "").trim(),
    description: String(input.description || "").trim(),
    price: Number(input.price),
    promo_price: input.promoPrice === null || input.promoPrice === "" || typeof input.promoPrice === "undefined"
      ? null
      : Number(input.promoPrice),
    category: String(input.category || "").trim(),
    image: String(input.image || "").trim()
  };
}

function validateProduct(product) {
  if (!product.name || !product.category || !Number.isFinite(product.price) || product.price <= 0) {
    return "Invalid product data";
  }
  if (product.promo_price !== null && (!Number.isFinite(product.promo_price) || product.promo_price <= 0 || product.promo_price >= product.price)) {
    return "Invalid promo price";
  }
  return null;
}

function sanitizeOrder(input) {
  return {
    id: crypto.randomUUID(),
    product_id: String(input.productId || "").trim(),
    product_name: String(input.productName || "").trim(),
    product_price: Number(input.productPrice),
    customer_name: String(input.customerName || "").trim(),
    customer_state: String(input.customerState || "").trim(),
    customer_phone: String(input.customerPhone || "").trim(),
    status: "جديد",
    created_at: new Date().toISOString()
  };
}

function validateOrder(order) {
  if (!order.product_id || !order.product_name || !order.customer_name || !order.customer_state || !/^(0[5-7])[0-9]{8}$/.test(order.customer_phone.replace(/\s/g, ""))) {
    return "Invalid order data";
  }
  if (!Number.isFinite(order.product_price) || order.product_price <= 0) {
    return "Invalid product price";
  }
  return null;
}

async function serveStatic(req, res, pathname) {
  const routeMap = {
    "/": "index.html",
    "/index.html": "index.html",
    "/admin": "admin.html",
    "/admin.html": "admin.html",
    "/js/api.js": path.join("js", "api.js")
  };

  const relativePath = routeMap[pathname];
  if (!relativePath) {
    json(res, 404, { error: "Not found" });
    return;
  }

  const filePath = path.join(ROOT, relativePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8"
  }[ext] || "application/octet-stream";

  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch {
    json(res, 404, { error: "File not found" });
  }
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/products") {
    const products = await readJson(DATA_FILES.products);
    json(res, 200, products);
    return;
  }

  if (req.method === "POST" && pathname === "/api/orders") {
    const body = await parseBody(req);
    const order = sanitizeOrder(body);
    const error = validateOrder(order);
    if (error) {
      json(res, 400, { error });
      return;
    }
    const orders = await readJson(DATA_FILES.orders);
    orders.unshift(order);
    await writeJson(DATA_FILES.orders, orders);
    json(res, 201, order);
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/login") {
    const body = await parseBody(req);
    const admin = await readJson(DATA_FILES.admin);
    if (body.username !== admin.username || hashPassword(String(body.password || "")) !== admin.password_hash) {
      json(res, 401, { error: "Invalid credentials" });
      return;
    }

    admin.last_login = new Date().toISOString();
    await writeJson(DATA_FILES.admin, admin);

    const token = crypto.randomUUID();
    sessions.set(token, { adminId: admin.id, createdAt: Date.now() });
    json(res, 200, {
      token,
      user: {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        last_login: admin.last_login
      }
    });
    return;
  }

  if (pathname.startsWith("/api/admin")) {
    const admin = await requireAdmin(req);
    if (!admin) {
      json(res, 401, { error: "Unauthorized" });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/profile") {
      json(res, 200, {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        last_login: admin.last_login
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/change-password") {
      const body = await parseBody(req);
      if (hashPassword(String(body.currentPassword || "")) !== admin.password_hash) {
        json(res, 400, { error: "Current password is incorrect" });
        return;
      }
      const newPassword = String(body.newPassword || "");
      if (newPassword.length < 6) {
        json(res, 400, { error: "New password must be at least 6 characters" });
        return;
      }
      admin.password_hash = hashPassword(newPassword);
      await writeJson(DATA_FILES.admin, admin);
      noContent(res);
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/orders") {
      const orders = await readJson(DATA_FILES.orders);
      json(res, 200, orders);
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/products") {
      const body = await parseBody(req);
      const product = sanitizeProduct(body);
      const error = validateProduct(product);
      if (error) {
        json(res, 400, { error });
        return;
      }
      const products = await readJson(DATA_FILES.products);
      products.unshift(product);
      await writeJson(DATA_FILES.products, products);
      json(res, 201, product);
      return;
    }

    if (req.method === "PUT" && pathname.startsWith("/api/admin/products/")) {
      const id = decodeURIComponent(pathname.split("/").pop());
      const body = await parseBody(req);
      const products = await readJson(DATA_FILES.products);
      const index = products.findIndex((product) => product.id === id);
      if (index === -1) {
        json(res, 404, { error: "Product not found" });
        return;
      }
      const updated = sanitizeProduct(body, id);
      const error = validateProduct(updated);
      if (error) {
        json(res, 400, { error });
        return;
      }
      products[index] = updated;
      await writeJson(DATA_FILES.products, products);
      json(res, 200, updated);
      return;
    }

    if (req.method === "DELETE" && pathname.startsWith("/api/admin/products/")) {
      const id = decodeURIComponent(pathname.split("/").pop());
      const products = await readJson(DATA_FILES.products);
      const nextProducts = products.filter((product) => product.id !== id);
      if (nextProducts.length === products.length) {
        json(res, 404, { error: "Product not found" });
        return;
      }
      await writeJson(DATA_FILES.products, nextProducts);
      noContent(res);
      return;
    }

    if (req.method === "PUT" && pathname.startsWith("/api/admin/orders/") && pathname.endsWith("/status")) {
      const parts = pathname.split("/");
      const orderId = decodeURIComponent(parts[4]);
      const body = await parseBody(req);
      const allowed = new Set(["جديد", "مؤكد", "مكتمل", "ملغي"]);
      if (!allowed.has(body.status)) {
        json(res, 400, { error: "Invalid order status" });
        return;
      }
      const orders = await readJson(DATA_FILES.orders);
      const index = orders.findIndex((order) => order.id === orderId);
      if (index === -1) {
        json(res, 404, { error: "Order not found" });
        return;
      }
      orders[index].status = body.status;
      await writeJson(DATA_FILES.orders, orders);
      json(res, 200, orders[index]);
      return;
    }
  }

  json(res, 404, { error: "Not found" });
}

async function requestListener(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (error) {
    const statusCode = error.message === "Invalid JSON body" ? 400 : 500;
    json(res, statusCode, { error: error.message || "Internal server error" });
  }
}

async function start() {
  await ensureDataFiles();
  const server = http.createServer(requestListener);
  server.listen(PORT, () => {
    console.log(`Chrif Store running on http://localhost:${PORT}`);
    console.log("Default admin login: admin / admin123");
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
