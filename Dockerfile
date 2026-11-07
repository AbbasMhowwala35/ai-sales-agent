FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build
WORKDIR /app/server
EXPOSE 4000
CMD ["node", "dist/index.js"]
