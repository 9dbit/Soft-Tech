FROM node:24-alpine
WORKDIR /app
COPY reference-wallet/package.json reference-wallet/server.mjs reference-wallet/wallet.mjs reference-wallet/durable-writes.mjs ./
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
