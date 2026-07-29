FROM node:20-alpine
WORKDIR /app

COPY package.json ./
COPY shared ./shared
COPY services/auth ./services/auth

RUN npm install --omit=dev --workspaces --include-workspace-root

ENV NODE_ENV=production
EXPOSE 4001
CMD ["node", "services/auth/src/index.js"]
