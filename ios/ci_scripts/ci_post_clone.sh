#!/bin/bash
set -e

echo "Installing XcodeGen..."
brew install xcodegen

echo "Generating Xcode project from project.yml..."
cd "$CI_PRIMARY_REPOSITORY_PATH/ios"
xcodegen generate

echo "Xcode project generated successfully."
