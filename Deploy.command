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
AHEAD=$(git log origin/main..HEAD 2>/dev/null)

if [ -z "$CHANGES" ] && [ -z "$AHEAD" ]; then
    echo -e "${YELLOW}Everything is already up-to-date!${NC}"
    echo "No new changes or unpushed files detected."
    echo ""
    echo -e "Would you like to ${CYAN}[F]orce Re-publish${NC} all files and trigger a fresh build? (y/n)"
    read -r -p "> " FORCE_RESP
    
    if [[ "$FORCE_RESP" =~ ^[Yy]$ ]]; then
        echo ""
        echo -e "${CYAN}🚀 Triggering a fresh, clean rebuild...${NC}"
        git commit --allow-empty -m "Force Re-publish: Fresh Build"
    else
        echo ""
        echo "Exiting..."
        sleep 2
        exit 0
    fi
fi

if [ -n "$AHEAD" ] && [ -z "$CHANGES" ]; then
    echo -e "${YELLOW}You have local commits that need to be pushed to the live site.${NC}"
fi

if [ -n "$CHANGES" ]; then
    echo -e "${YELLOW}Detected the following uncommitted changes:${NC}"
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
    echo -e "${CYAN}🚀 Staging & committing changes...${NC}"
    git add .
    git commit -m "$MSG"
fi

echo ""
echo -e "${YELLOW}Uploading to GitHub & Vercel...${NC}"
echo ""

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
