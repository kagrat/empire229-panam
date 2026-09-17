import { verifyToken } from "./auth.js";
import { db } from "./db.js";

/** Exige un jeton valide ; attache req.user = {username, role, name}. */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentification requise." });

  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Session invalide ou expirée." });

  // On revérifie que le compte existe toujours et est actif à chaque
  // requête : un compte désactivé par le propriétaire perd l'accès
  // immédiatement, sans attendre l'expiration du jeton.
  const user = db.all("users").find((u) => u.username === payload.username);
  if (!user || user.active === false) {
    return res.status(401).json({ error: "Ce compte n'est plus actif." });
  }

  req.user = { username: user.username, role: user.role, name: user.name };
  next();
}

/** Exige le rôle "owner" (propriétaire de la boutique). */
export function requireOwner(req, res, next) {
  if (!req.user || req.user.role !== "owner") {
    return res.status(403).json({ error: "Action réservée au propriétaire de la boutique." });
  }
  next();
}
