FROM node:24-alpine
WORKDIR /app
COPY qualification/client.mjs qualification/native-load.mjs qualification/cloud-runner.mjs qualification/wallet-conformance.mjs qualification/native-chaos.mjs qualification/volume-recovery.mjs qualification/runner-diagnostics.mjs qualification/session-transport.mjs qualification/gameplay-diagnostics.mjs ./qualification/
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "qualification/cloud-runner.mjs"]
