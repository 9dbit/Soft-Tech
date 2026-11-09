FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY . .
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
