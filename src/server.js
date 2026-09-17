import "dotenv/config";
import express from "express";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import rateLimit from "express-rate-limit";

import { db } from "./db.js";
import { hashPassword, verifyPassword, signToken } from "./auth.js";
import { requireAuth, requireOwner } from "./middleware.js";
import { seedIfEmpty } from "./seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false })); // CSP à affiner selon votre nom de domaine en prod
app.use(express.json({ limit: "1mb" }));

/* ------------------------------------------------------------------ */
/* Auth                                                                 */
/* ------------------------------------------------------------------ */

// Limite les tentatives de connexion pour freiner le bruteforce.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives. Réessayez dans quelques minutes." }
});

app.post("/api/auth/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Identifiant et mot de passe requis." });
  }
  const user = db.all("users").find((u) => u.username === username.trim());
  if (!user) return res.status(401).json({ error: "Identifiant ou mot de passe incorrect." });
  if (user.active === false) {
    return res.status(403).json({ error: "Ce compte a été désactivé." });
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Identifiant ou mot de passe incorrect." });

  const token = signToken(user);
  res.json({ token, user: { username: user.username, name: user.name, role: user.role } });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "Le mot de passe doit contenir au moins 6 caractères." });
  }
  await db.update("users", req.user.username, { passwordHash: await hashPassword(newPassword) });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Utilisateurs (propriétaire uniquement)                               */
/* ------------------------------------------------------------------ */

app.get("/api/users", requireAuth, requireOwner, (req, res) => {
  const users = db.all("users").map(({ passwordHash, ...rest }) => rest);
  res.json(users);
});

app.post("/api/users", requireAuth, requireOwner, async (req, res) => {
  const { name, username, password } = req.body || {};
  if (!name || !username || !password) {
    return res.status(400).json({ error: "Nom, identifiant et mot de passe sont requis." });
  }
  const clean = username.trim().toLowerCase().replace(/\s+/g, ".");
  if (db.all("users").some((u) => u.username === clean)) {
    return res.status(409).json({ error: "Cet identifiant existe déjà." });
  }
  const record = await db.insert("users", {
    id: clean,
    username: clean,
    name,
    role: "gerant",
    passwordHash: await hashPassword(password),
    active: true,
    createdAt: new Date().toISOString()
  });
  const { passwordHash, ...safe } = record;
  res.status(201).json(safe);
});

app.patch("/api/users/:username", requireAuth, requireOwner, async (req, res) => {
  const { active } = req.body || {};
  const target = db.all("users").find((u) => u.username === req.params.username);
  if (!target) return res.status(404).json({ error: "Compte introuvable." });
  if (target.role === "owner") {
    return res.status(400).json({ error: "Impossible de modifier le compte propriétaire ici." });
  }
  const updated = await db.update("users", target.id, { active: !!active });
  const { passwordHash, ...safe } = updated;
  res.json(safe);
});

app.post("/api/users/:username/reset-password", requireAuth, requireOwner, async (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 6) {
    return res.status(400).json({ error: "Le mot de passe doit contenir au moins 6 caractères." });
  }
  const target = db.all("users").find((u) => u.username === req.params.username);
  if (!target) return res.status(404).json({ error: "Compte introuvable." });
  await db.update("users", target.id, { passwordHash: await hashPassword(password) });
  res.json({ ok: true });
});

app.delete("/api/users/:username", requireAuth, requireOwner, async (req, res) => {
  const target = db.all("users").find((u) => u.username === req.params.username);
  if (!target) return res.status(404).json({ error: "Compte introuvable." });
  if (target.role === "owner") {
    return res.status(400).json({ error: "Impossible de supprimer le compte propriétaire." });
  }
  await db.remove("users", target.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Produits / inventaire                                                */
/* ------------------------------------------------------------------ */

app.get("/api/products", requireAuth, (req, res) => res.json(db.all("products")));

app.post("/api/products", requireAuth, async (req, res) => {
  const { brand, name, category, condition, price, cost, stock } = req.body || {};
  if (!name || !(price > 0)) {
    return res.status(400).json({ error: "Le modèle et un prix valide sont requis." });
  }
  const record = await db.insert("products", {
    brand: brand || "",
    name,
    category: category || "Téléphones",
    condition: condition || "Neuf",
    price: Number(price) || 0,
    cost: Number(cost) || 0,
    stock: Number(stock) || 0
  });
  res.status(201).json(record);
});

app.patch("/api/products/:id", requireAuth, async (req, res) => {
  const updated = await db.update("products", req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "Article introuvable." });
  res.json(updated);
});

app.delete("/api/products/:id", requireAuth, requireOwner, async (req, res) => {
  const ok = await db.remove("products", req.params.id);
  if (!ok) return res.status(404).json({ error: "Article introuvable." });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Clients                                                              */
/* ------------------------------------------------------------------ */

app.get("/api/clients", requireAuth, (req, res) => res.json(db.all("clients")));

app.post("/api/clients", requireAuth, async (req, res) => {
  const { name, phone, notes } = req.body || {};
  if (!name) return res.status(400).json({ error: "Le nom du client est requis." });
  const record = await db.insert("clients", {
    name,
    phone: phone || "",
    notes: notes || "",
    totalSpent: 0,
    lastPurchase: null
  });
  res.status(201).json(record);
});

app.patch("/api/clients/:id", requireAuth, async (req, res) => {
  const updated = await db.update("clients", req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "Client introuvable." });
  res.json(updated);
});

/* ------------------------------------------------------------------ */
/* Ventes (point de vente)                                              */
/* ------------------------------------------------------------------ */

app.get("/api/sales", requireAuth, (req, res) => res.json(db.all("sales")));

app.post("/api/sales", requireAuth, async (req, res) => {
  const { items, paymentMethod, clientId } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Le panier est vide." });
  }

  // On revérifie le stock et les prix côté serveur (jamais confiance au client).
  const products = db.all("products");
  let total = 0;
  const resolvedItems = [];
  for (const line of items) {
    const product = products.find((p) => p.id === line.productId);
    if (!product) return res.status(400).json({ error: "Article introuvable : " + line.productId });
    const qty = Math.max(1, Number(line.qty) || 1);
    if (product.stock < qty) {
      return res.status(409).json({ error: `Stock insuffisant pour ${product.name}.` });
    }
    total += product.price * qty;
    resolvedItems.push({ productId: product.id, name: product.name, price: product.price, qty });
  }

  for (const line of resolvedItems) {
    const product = products.find((p) => p.id === line.productId);
    await db.update("products", product.id, { stock: product.stock - line.qty });
  }

  let clientName = "Client passage";
  if (clientId) {
    const client = db.findById("clients", clientId);
    if (client) {
      clientName = client.name;
      await db.update("clients", client.id, {
        totalSpent: (client.totalSpent || 0) + total,
        lastPurchase: new Date().toISOString()
      });
    }
  }

  const sale = await db.insert("sales", {
    date: new Date().toISOString(),
    items: resolvedItems,
    total,
    paymentMethod: paymentMethod || "Espèces",
    clientId: clientId || null,
    clientName,
    soldBy: req.user.name
  });
  res.status(201).json(sale);
});

/* ------------------------------------------------------------------ */
/* Réparations                                                          */
/* ------------------------------------------------------------------ */

app.get("/api/repairs", requireAuth, (req, res) => res.json(db.all("repairs")));

app.post("/api/repairs", requireAuth, async (req, res) => {
  const { clientName, device, issue, cost } = req.body || {};
  if (!clientName || !device) {
    return res.status(400).json({ error: "Client et appareil sont requis." });
  }
  const record = await db.insert("repairs", {
    clientName,
    device,
    issue: issue || "",
    cost: Number(cost) || 0,
    status: "recu",
    receivedAt: new Date().toISOString(),
    technician: req.user.name
  });
  res.status(201).json(record);
});

app.patch("/api/repairs/:id", requireAuth, async (req, res) => {
  const { status } = req.body || {};
  if (!["recu", "en_reparation", "pret"].includes(status)) {
    return res.status(400).json({ error: "Statut invalide." });
  }
  const updated = await db.update("repairs", req.params.id, { status });
  if (!updated) return res.status(404).json({ error: "Dossier introuvable." });
  res.json(updated);
});

/* ------------------------------------------------------------------ */
/* Échanges / troc                                                      */
/* ------------------------------------------------------------------ */

app.get("/api/trocs", requireAuth, (req, res) => res.json(db.all("trocs")));

app.post("/api/trocs", requireAuth, async (req, res) => {
  const { deviceInBrand, deviceInModel, imei, valueIn, clientName, outProductId, outPrice, note, paymentMethod } =
    req.body || {};
  const outProduct = db.findById("products", outProductId);
  if (!deviceInModel || !outProduct || !(outPrice > 0)) {
    return res.status(400).json({ error: "Informations d'échange incomplètes." });
  }
  if (outProduct.stock < 1) {
    return res.status(409).json({ error: "Article de sortie en rupture de stock." });
  }
  const inValue = Math.max(0, Number(valueIn) || 0);
  const complement = Math.max(0, Number(outPrice) - inValue);

  await db.update("products", outProduct.id, { stock: outProduct.stock - 1 });
  await db.insert("products", {
    brand: deviceInBrand || "",
    name: `${deviceInModel} (reprise)`,
    category: "Occasion / Reprise",
    condition: req.body.condition || "Bon",
    price: Math.round(inValue * 1.15) || inValue,
    cost: inValue,
    stock: 1
  });
  const troc = await db.insert("trocs", {
    date: new Date().toISOString(),
    clientName: clientName || "",
    imei: imei || "",
    deviceIn: `${deviceInBrand || ""} ${deviceInModel}`.trim(),
    valueIn: inValue,
    deviceOut: outProduct.name,
    valueOut: Number(outPrice),
    complement,
    note: note || "",
    handledBy: req.user.name
  });
  await db.insert("sales", {
    date: new Date().toISOString(),
    items: [{ productId: outProduct.id, name: outProduct.name + " (échange)", price: complement, qty: 1 }],
    total: complement,
    paymentMethod: paymentMethod || "Espèces",
    clientId: null,
    clientName: clientName || "Client passage",
    soldBy: req.user.name
  });
  res.status(201).json(troc);
});

/* ------------------------------------------------------------------ */
/* Fournisseurs                                                        */
/* ------------------------------------------------------------------ */

app.get("/api/suppliers", requireAuth, (req, res) => res.json(db.all("suppliers")));

app.post("/api/suppliers", requireAuth, requireOwner, async (req, res) => {
  const { name, contact, items, amountDue } = req.body || {};
  if (!name) return res.status(400).json({ error: "Le nom du fournisseur est requis." });
  const record = await db.insert("suppliers", {
    name,
    contact: contact || "",
    items: items || "",
    amountDue: Number(amountDue) || 0
  });
  res.status(201).json(record);
});

app.patch("/api/suppliers/:id", requireAuth, requireOwner, async (req, res) => {
  const updated = await db.update("suppliers", req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "Fournisseur introuvable." });
  res.json(updated);
});

app.delete("/api/suppliers/:id", requireAuth, requireOwner, async (req, res) => {
  const ok = await db.remove("suppliers", req.params.id);
  if (!ok) return res.status(404).json({ error: "Fournisseur introuvable." });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Dépenses                                                             */
/* ------------------------------------------------------------------ */

app.get("/api/expenses", requireAuth, (req, res) => res.json(db.all("expenses")));

app.post("/api/expenses", requireAuth, async (req, res) => {
  const { date, category, description, amount } = req.body || {};
  if (!(amount > 0)) return res.status(400).json({ error: "Montant invalide." });
  const record = await db.insert("expenses", {
    date: date || new Date().toISOString().slice(0, 10),
    category: category || "Autre",
    description: description || "",
    amount: Number(amount),
    recordedBy: req.user.name
  });
  res.status(201).json(record);
});

app.delete("/api/expenses/:id", requireAuth, requireOwner, async (req, res) => {
  const ok = await db.remove("expenses", req.params.id);
  if (!ok) return res.status(404).json({ error: "Dépense introuvable." });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Paramètres                                                           */
/* ------------------------------------------------------------------ */

app.get("/api/settings", requireAuth, (req, res) => res.json(db.get("settings")));

app.patch("/api/settings", requireAuth, requireOwner, async (req, res) => {
  const current = db.get("settings");
  const updated = await db.setKey("settings", { ...current, ...req.body });
  res.json(updated);
});

/* ------------------------------------------------------------------ */
/* Rapports (propriétaire uniquement)                                   */
/* ------------------------------------------------------------------ */

app.get("/api/reports/summary", requireAuth, requireOwner, (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const products = db.all("products");
  const sales = db.all("sales").filter((s) => (s.date || "").slice(0, 7) === month);
  const expenses = db.all("expenses").filter((e) => (e.date || "").slice(0, 7) === month);

  const ca = sales.reduce((a, s) => a + s.total, 0);
  const expensesTotal = expenses.reduce((a, e) => a + e.amount, 0);
  let cogs = 0;
  const byCategory = {};
  sales.forEach((s) =>
    (s.items || []).forEach((it) => {
      const product = products.find((p) => p.id === it.productId);
      if (product) cogs += (product.cost || 0) * it.qty;
      const cat = product ? product.category : "Autre";
      byCategory[cat] = (byCategory[cat] || 0) + it.price * it.qty;
    })
  );
  const margin = ca - cogs;
  const netProfit = margin - expensesTotal;

  res.json({
    month,
    revenue: ca,
    salesCount: sales.length,
    cogs,
    grossMargin: margin,
    expensesTotal,
    netProfit,
    averageBasket: sales.length ? ca / sales.length : 0,
    revenueByCategory: byCategory
  });
});

app.get("/api/reports/export.csv", requireAuth, requireOwner, (req, res) => {
  const rows = [["Date", "Client", "Articles", "Total", "Paiement", "Vendeur"]];
  db.all("sales").forEach((s) =>
    rows.push([
      s.date,
      s.clientName || "",
      (s.items || []).map((i) => `${i.name} x${i.qty}`).join(" | "),
      s.total,
      s.paymentMethod,
      s.soldBy || ""
    ])
  );
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="empire229-ventes.csv"');
  res.send(csv);
});

/* ------------------------------------------------------------------ */
/* Frontend statique                                                    */
/* ------------------------------------------------------------------ */

app.use(express.static(path.join(__dirname, "..", "public")));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Route API inconnue." });
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

/* ------------------------------------------------------------------ */

seedIfEmpty()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Empire 229 · Panam en écoute sur http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Échec de l'initialisation :", err);
    process.exit(1);
  });
