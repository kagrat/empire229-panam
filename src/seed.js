import { db } from "./db.js";
import { hashPassword } from "./auth.js";

export async function seedIfEmpty() {
  const users = db.all("users");
  if (users.length === 0) {
    const username = process.env.INITIAL_OWNER_USERNAME || "proprietaire";
    const password = process.env.INITIAL_OWNER_PASSWORD || "ChangezMoi2026!";
    const name = process.env.INITIAL_OWNER_NAME || "Propriétaire";

    await db.insert("users", {
      id: username,
      username,
      name,
      role: "owner",
      passwordHash: await hashPassword(password),
      active: true,
      createdAt: new Date().toISOString()
    });

    console.log("──────────────────────────────────────────────────────────");
    console.log(" Compte propriétaire créé automatiquement (premier démarrage) :");
    console.log("   Identifiant : " + username);
    console.log("   Mot de passe : celui défini dans .env (INITIAL_OWNER_PASSWORD)");
    console.log(" → Connectez-vous puis changez ce mot de passe immédiatement.");
    console.log("──────────────────────────────────────────────────────────");
  }

  const settings = db.get("settings");
  if (!settings || !settings.shopName) {
    await db.setKey("settings", {
      shopName: process.env.SHOP_NAME || "Empire 229 · Panam",
      location: process.env.SHOP_LOCATION || "Boutique Ganhi",
      currency: "F",
      lowStockThreshold: 5,
      rccm: "",
      ifu: "",
      phone: ""
    });
  }
}
