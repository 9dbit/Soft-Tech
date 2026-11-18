FROM node:24-bookworm-slim
WORKDIR /app
COPY development ./development
COPY public/Minecraft.woff2 ./public/Minecraft.woff2
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "development/server.mjs"]
