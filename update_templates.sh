#!/usr/bin/env bash
# Run this from your repo root ONCE after dropping in the new artha/ package.
# It rewrites all url_for() route references in your templates for Blueprint naming.
# Safe to run multiple times (idempotent after first run).

set -euo pipefail

TEMPLATES="./templates"

echo "Updating url_for() references in $TEMPLATES ..."

# macOS sed requires '' after -i; Linux does not.
# This script auto-detects which sed flavour is available.
SED_INPLACE=(-i '')
if sed --version 2>/dev/null | grep -q GNU; then
  SED_INPLACE=(-i)
fi

find "$TEMPLATES" -name "*.html" | while read -r file; do
  sed "${SED_INPLACE[@]}" \
    -e "s/url_for('login')/url_for('auth.login')/g" \
    -e "s/url_for('register')/url_for('auth.register')/g" \
    -e "s/url_for('logout')/url_for('auth.logout')/g" \
    -e "s/url_for('change_password')/url_for('auth.change_password')/g" \
    -e "s/url_for('index')/url_for('dashboard.index')/g" \
    "$file"
  echo "  Updated: $file"
done

echo "Done. Verify with: grep -r \"url_for('\" templates/"
