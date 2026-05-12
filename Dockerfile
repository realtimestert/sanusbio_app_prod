FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY server.js ./
COPY index.html ./
# Uploads directory — mount as a volume in docker-compose to persist photos
RUN mkdir -p /app/uploads
EXPOSE 4000
CMD ["node", "server.js"]