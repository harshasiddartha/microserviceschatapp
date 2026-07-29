FROM node:20-alpine
WORKDIR /app

COPY package.json ./
COPY shared ./shared
COPY services/notification ./services/notification

RUN npm install --omit=dev --workspaces --include-workspace-root

ENV NODE_ENV=production
EXPOSE 4003
CMD ["node", "services/notification/src/index.js"]
