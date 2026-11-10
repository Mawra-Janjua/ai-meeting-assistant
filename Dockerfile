FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
# Listen on all interfaces inside the container; the server refuses to start without API_KEY.
ENV HOST=0.0.0.0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 4104
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4104/health || exit 1
CMD ["node", "src/server.ts"]
