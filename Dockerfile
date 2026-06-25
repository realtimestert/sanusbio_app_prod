FROM node:20-alpine
WORKDIR /app

# Install dependencies first (cached layer)
COPY package*.json ./
RUN npm install --production

# Copy all app files in one step — no need to update this when adding new files
COPY . .

RUN mkdir -p /app/uploads

EXPOSE 4000
CMD ["node", "server.js"]