# Bliscord server (also serves the web version of the client at /)
FROM node:24-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY index.html vite.config.mjs ./
COPY public ./public
COPY src ./src
COPY shared ./shared
RUN npx vite build

FROM node:24-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    WEB_DIR=/app/dist
WORKDIR /app/server
COPY shared/ /app/shared/
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=web /app/dist /app/dist
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "index.js"]
