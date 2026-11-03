FROM node:22-alpine
RUN apk add --no-cache bash
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY mcp-server.js ws-bridge.js config.js keystore.js tui.js ./
COPY ocf-tui /usr/local/bin/ocf-tui
RUN sed -i 's/\r$//' /usr/local/bin/ocf-tui && chmod 755 /usr/local/bin/ocf-tui
USER node
