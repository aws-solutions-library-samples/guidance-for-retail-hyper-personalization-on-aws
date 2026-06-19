#!/bin/bash
set -e
cd "$(dirname "$0")"
rm -rf nodejs build
mkdir -p nodejs
cp package.json nodejs/
cd nodejs
npm install --omit=dev
cd ..
mkdir -p build
zip -r build/jwt-layer.zip nodejs
echo "JWT layer built successfully"
