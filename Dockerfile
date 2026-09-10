FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3107 DATA_DIR=/data SCRAPE_PROVIDER=apify
EXPOSE 3107
CMD ["node", "server.mjs"]
