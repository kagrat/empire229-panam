FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public

# Le dossier data/ contient la base JSON : montez-le en volume pour
# conserver vos données entre les redéploiements du conteneur.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/server.js"]
