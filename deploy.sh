#!/bin/bash

# Define the repository installation directory
REPO_DIR=$(pwd) # This is where the repo is cloned (e.g., /home/user/source-code)

# --- 1. Install Dependencies & Build Frontend using NPM Scripts ---
echo "Installing dependencies and running build scripts..."

# Install root dependencies (for ts-node, concurrently, etc.)
npm install

# Build frontend using the script defined in the root package.json
# This script handles installing frontend dependencies and running the build
echo "Building frontend..."
npm run build-frontend


# --- 2. Deploy Frontend (Move static files) ---
# The build output is likely in src/frontend/build
FRONTEND_SOURCE_DIR="$REPO_DIR/src/frontend/build"

# !!! REPLACE THIS PATH WITH YOUR ACTUAL HOSTINGER PUBLIC_HTML PATH !!!
FRONTEND_TARGET="/home/uXXXXXX/domains/yourdomain.com/public_html" 

echo "Deploying client to public_html..."

# Remove previous files and copy the new build files
rm -rf $FRONTEND_TARGET/*
cp -r $FRONTEND_SOURCE_DIR/* $FRONTEND_TARGET/
chmod -R 755 $FRONTEND_TARGET 


# --- 3. Start the Backend API on internal port 8080 using NPM Start ---
echo "Starting backend API service on port 8080..."

# Kill any existing node process to ensure a clean start
# We kill the process associated with the Node.js server itself
pkill -f 'ts-node' 

# Set Environment Variables (REQUIRED: Replace values with your actual secrets/config!)
export DB_HOST="mysql.hostinger.com" 
export DB_USER="uXXXXX"
export DB_PASS="YourSecurePassword"
export DB_NAME="notes_app"
export FRONTEND_URL="https://yourdomain.com"
export GOOGLE_CLIENT_ID="YourClientID"
export GOOGLE_CLIENT_SECRET="YourClientSecret"
export REDIRECT_URI="https://yourdomain.com/api/oauth/callback"
export PORT="8080" # Must match the port in the .htaccess proxy rule

# Run the 'start' script from the root package.json using 'nohup'
# The 'start' script correctly executes 'ts-node src/server.ts'
nohup npm start & 

echo "Deployment finished. API started in background."