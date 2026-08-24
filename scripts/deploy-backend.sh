#!/bin/bash

# ValidFi Backend Deployment Script
# This script deploys the NestJS backend to production

set -e

# Configuration
ENV="${1:-production}"
BUILD_DIR="./backend/dist"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== SecureData Backend Deployment ===${NC}"
echo "Environment: $ENV"
echo ""

# Check if .env file exists
if [ ! -f "./backend/.env" ]; then
    echo -e "${RED}Error: .env file not found${NC}"
    echo "Please create a .env file in the backend directory"
    exit 1
fi

# Install dependencies
echo -e "${YELLOW}Installing dependencies...${NC}"
cd backend
npm install --production
echo -e "${GREEN}Dependencies installed${NC}"
echo ""

# Build the application
echo -e "${YELLOW}Building application...${NC}"
npm run build
echo -e "${GREEN}Build complete${NC}"
echo ""

# Run database migrations
echo -e "${YELLOW}Running database migrations...${NC}"
npm run migration:run:prod
echo -e "${GREEN}Migrations complete${NC}"
echo ""

# Start the application
echo -e "${YELLOW}Starting application...${NC}"
if [ "$ENV" = "production" ]; then
    npm run start:prod
else
    npm run start:dev
fi
