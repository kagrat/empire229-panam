# Empire 229 · Panam — Application de gestion de boutique

Application complète de gestion pour une boutique de vente/réparation de
téléphones : point de vente, inventaire, clients, réparations, échanges/troc,
fournisseurs, dépenses, rapports financiers.

**Deux rôles** :
- **Propriétaire** (`owner`) : accès complet, y compris les rapports
  financiers et la gestion des comptes gérant.
- **Gérant** (`gerant`) : caisse, inventaire, clients, réparations, troc,
  fournisseurs (lecture), dépenses — sans accès aux marges ni à l'équipe.

Stack : Node.js + Express, base de données fichier JSON (aucune installation
de base de données externe requise), authentification par jeton JWT avec
mots de passe hachés (bcrypt).

---

## 1. Installation locale (pour tester)

Prérequis : [Node.js](https://nodejs.org) version 18 ou plus.

```bash
cd server
cp .env.example .env
```

Ouvrez `.env` et changez au minimum :
- `JWT_SECRET` — générez une valeur aléatoire avec :
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- `INITIAL_OWNER_PASSWORD` — le mot de passe du tout premier compte
  propriétaire.

Puis :

```bash
npm install
npm start
```

L'application est disponible sur **http://localhost:3000**.
Connectez-vous avec l'identifiant `INITIAL_OWNER_USERNAME` et le mot de passe
`INITIAL_OWNER_PASSWORD` définis dans `.env`, puis changez immédiatement ce
mot de passe depuis **Paramètres → Mon mot de passe**.

---

## 2. Déployer sur un VPS (Ubuntu/Debian), avec PM2

```bash
# Sur le serveur
sudo apt update && sudo apt install -y nodejs npm
sudo npm install -g pm2

# Copiez le dossier server/ sur le serveur, puis :
cd server
cp .env.example .env
nano .env   # renseignez JWT_SECRET, le mot de passe initial, etc.
npm install --omit=dev

pm2 start src/server.js --name empire229
pm2 save
pm2 startup   # suivez l'instruction affichée pour démarrer au boot
```

Mettez ensuite un reverse proxy devant (Nginx recommandé) pour servir
l'application en HTTPS sur votre nom de domaine :

```nginx
server {
    listen 80;
    server_name votredomaine.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Puis activez le HTTPS gratuitement avec [Certbot](https://certbot.eff.org/) :

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d votredomaine.com
```

**Ne servez jamais cette application en HTTP simple sur Internet** : sans
HTTPS, le mot de passe et le jeton de connexion circulent en clair.

---

## 3. Déployer avec Docker

```bash
cd server
cp .env.example .env
nano .env
docker compose up -d --build
```

L'application écoute sur le port 3000 du serveur ; mettez un reverse proxy
(Nginx, Caddy, Traefik) devant pour le HTTPS, comme ci-dessus.

---

## 4. Déployer sur une plateforme cloud (Render, Railway, etc.)

1. Poussez le contenu de `server/` sur un dépôt Git.
2. Créez un nouveau service "Web Service" à partir du dépôt.
3. Commande de build : `npm install --omit=dev`
4. Commande de démarrage : `node src/server.js`
5. Renseignez les variables d'environnement du fichier `.env.example` dans
   les paramètres de la plateforme.
6. **Important** : ces plateformes ont souvent un système de fichiers
   éphémère (les fichiers sont effacés à chaque redéploiement). Si c'est le
   cas de la vôtre, montez un disque persistant sur le dossier `data/`
   (Render et Railway proposent tous deux des "volumes"/"disks" persistants)
   — sinon vos ventes, clients et stock seront perdus à chaque mise à jour.

---

## 5. Sauvegardes

Toutes les données vivent dans un seul fichier : `data/db.json`. Sauvegardez
ce fichier régulièrement (cron + copie vers un stockage externe, ou simple
copie manuelle) :

```bash
cp data/db.json sauvegardes/db-$(date +%Y%m%d-%H%M).json
```

---

## 6. Sécurité — à lire avant une mise en production réelle

Cette base est solide pour une petite boutique (mots de passe hachés avec
bcrypt, jetons JWT, limitation des tentatives de connexion, contrôle
d'accès serveur par rôle sur chaque route), mais gardez en tête :

- **HTTPS obligatoire** en production (voir section 2).
- Le stockage JSON convient à un volume modeste (quelques milliers
  d'enregistrements). Si votre boutique grandit fortement (plusieurs
  points de vente, gros volume de ventes), migrez vers PostgreSQL —
  la logique métier dans `src/server.js` reste presque identique, seule
  la couche `src/db.js` doit être remplacée par de vraies requêtes SQL.
- Changez `JWT_SECRET` avant toute mise en ligne réelle ; ne le partagez
  jamais et ne le committez pas dans Git (`.env` est déjà ignoré par
  `.gitignore`).
- Le fichier `data/db.json` contient les mots de passe **hachés** (pas en
  clair) mais reste une donnée sensible : ne l'exposez jamais publiquement
  et sauvegardez-le dans un endroit sécurisé.
- Il n'y a actuellement qu'un seul compte "propriétaire". Si vous perdez son
  mot de passe, un administrateur système peut le réinitialiser directement
  en modifiant `data/db.json` (remplacez `passwordHash` par un nouveau hash
  bcrypt) ou en relançant un script de réinitialisation — n'hésitez pas à
  demander de l'aide pour écrire ce script le moment venu.

---

## 7. Structure du projet

```
server/
  src/
    server.js       → routes API + démarrage du serveur
    db.js            → stockage JSON avec écritures sérialisées
    auth.js          → hachage de mot de passe + JWT
    middleware.js    → authentification et contrôle de rôle
    seed.js          → création du premier compte propriétaire
  public/
    index.html       → page unique de l'application
    app.js           → logique frontend (appels API, écrans)
    styles.css       → design de l'application
  data/
    db.json          → toutes les données (créé automatiquement)
  .env.example       → variables d'environnement à copier en .env
  Dockerfile / docker-compose.yml
```
