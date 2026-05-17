#!/bin/bash

# Clear screen for a neat dashboard
clear

# Navigate to the script's directory
cd "$(dirname "$0")"

# Colors for a premium look
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${CYAN}===============================================${NC}"
echo -e "${CYAN}         🌿 OBSIDIAN-FOR-WEB DEPLOYER          ${NC}"
echo -e "${CYAN}===============================================${NC}"
echo ""

# Check if there are actually any changes
CHANGES=$(git status --porcelain)

if [ -z "$CHANGES" ]; then
    echo -e "${GREEN}✓ Everything is already up-to-date!${NC}"
    echo "No local changes detected in your workspace."
    echo ""
    echo "Closing in 3 seconds..."
    sleep 3
    exit 0
fi

echo -e "${YELLOW}Detected the following changes:${NC}"
git status -s
echo ""
echo -e "${CYAN}-----------------------------------------------${NC}"

# Ask for a commit message, default to auto-generated timestamp
echo -e "Enter a short update description (optional):"
read -r -p "> " MSG

if [ -z "$MSG" ]; then
    TIMESTAMP=$(date "+%b %d, %Y at %I:%M %p")
    MSG="Automatic update on $TIMESTAMP"
fi

echo ""
echo -e "${CYAN}🚀 Starting deployment...${NC}"
echo ""

# Run git commands
echo -e "${YELLOW}[1/3] Staging changes...${NC}"
git add .

echo -e "${YELLOW}[2/3] Creating commit...${NC}"
git commit -m "$MSG"

echo -e "${YELLOW}[3/3] Uploading to GitHub & Vercel...${NC}"
git push origin main

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}===============================================${NC}"
    echo -e "${GREEN}       🎉 DEPLOYMENT COMPLETED SUCCESSFULLY!   ${NC}"
    echo -e "${GREEN}===============================================${NC}"
    echo -e "${GREEN}Your changes have been uploaded to GitHub!${NC}"
    echo -e "Vercel is now building your live website."
    echo ""
else
    echo ""
    echo -e "${RED}===============================================${NC}"
    echo -e "${RED}             ❌ DEPLOYMENT FAILED              ${NC}"
    echo -e "${RED}===============================================${NC}"
    echo -e "Please check your internet connection or git login."
    echo ""
fi

# Pause before closing terminal
echo "Press [Enter] to exit..."
read
