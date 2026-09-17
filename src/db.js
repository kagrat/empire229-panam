import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

/**
 * Stockage simple en fichier JSON, avec écritures mises en file d'attente
 * pour éviter deux écritures concurrentes qui se marchent dessus.
 *
 * C'est volontairement simple pour permettre un déploiement sans aucune
 * base de données externe à installer/configurer. Pour une boutique avec
 * un volume de données important ou plusieurs points de vente, migrez
 * vers PostgreSQL ou MySQL : la surface d'API ci-dessous (get/set par
 * collection) reste la même à adapter derrière une vraie requête SQL.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const DEFAULT_DATA = {
  users: [],
  products: [],
  sales: [],
  clients: [],
  repairs: [],
  trocs: [],
  suppliers: [],
  expenses: [],
  settings: {
    shopName: "Empire 229 · Panam",
    location: "Boutique Ganhi",
    currency: "F",
    lowStockThreshold: 5
  }
};

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DATA, null, 2), "utf-8");
  }
}
ensureFile();

let cache = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
let writeQueue = Promise.resolve();

function persist() {
  // Sérialise les écritures : chaque appel attend la précédente avant
  // d'écrire, pour éviter une corruption du fichier sous forte charge.
  writeQueue = writeQueue.then(
    () =>
      new Promise((resolve, reject) => {
        const tmpFile = DB_FILE + ".tmp";
        fs.writeFile(tmpFile, JSON.stringify(cache, null, 2), "utf-8", (err) => {
          if (err) return reject(err);
          fs.rename(tmpFile, DB_FILE, (err2) => (err2 ? reject(err2) : resolve()));
        });
      })
  );
  return writeQueue;
}

export const db = {
  /** Renvoie une copie profonde de toute une collection (tableau). */
  all(collection) {
    return JSON.parse(JSON.stringify(cache[collection] || []));
  },

  /** Renvoie un objet de config (non-tableau), ex. "settings". */
  get(key) {
    return JSON.parse(JSON.stringify(cache[key]));
  },

  findById(collection, id) {
    const item = (cache[collection] || []).find((x) => x.id === id);
    return item ? JSON.parse(JSON.stringify(item)) : null;
  },

  async insert(collection, data) {
    const id = data.id || randomUUID();
    const record = { ...data, id };
    cache[collection].push(record);
    await persist();
    return JSON.parse(JSON.stringify(record));
  },

  async update(collection, id, patch) {
    const idx = (cache[collection] || []).findIndex((x) => x.id === id);
    if (idx === -1) return null;
    cache[collection][idx] = { ...cache[collection][idx], ...patch };
    await persist();
    return JSON.parse(JSON.stringify(cache[collection][idx]));
  },

  async remove(collection, id) {
    const before = cache[collection].length;
    cache[collection] = cache[collection].filter((x) => x.id !== id);
    await persist();
    return cache[collection].length < before;
  },

  async setKey(key, value) {
    cache[key] = value;
    await persist();
    return JSON.parse(JSON.stringify(cache[key]));
  }
};
