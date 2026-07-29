FROM node:20-alpine
WORKDIR /app

COPY package.json ./
COPY shared ./shared
COPY services/chat ./services/chat

RUN npm install --omit=dev --workspaces --include-workspace-root

ENV NODE_ENV=production
EXPOSE 4002
CMD ["node", "services/chat/src/index.js"]
