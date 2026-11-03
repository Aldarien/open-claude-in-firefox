FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY mcp-server.js ws-bridge.js config.js keystore.js tui.js ./
USER node
