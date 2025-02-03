# Use Node.js as the base image
FROM node:16

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the application code
COPY . .

# Expose the backend port (e.g., 5000)
EXPOSE 5000

# Start the server
CMD ["node", "server.js"]
