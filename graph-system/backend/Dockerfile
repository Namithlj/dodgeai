FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src ./src
COPY sap-o2c-data ./sap-o2c-data

# Expose port
EXPOSE 4000

# Start server
CMD ["npm", "start"]
