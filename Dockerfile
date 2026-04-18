FROM node:20-alpine
WORKDIR /app

# Copy backend package files and install deps
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm install --production

# Copy source
COPY backend ./backend
COPY frontend ./frontend

WORKDIR /app/backend
ENV NODE_ENV=production
EXPOSE 5000
CMD ["node", "server.js"]
