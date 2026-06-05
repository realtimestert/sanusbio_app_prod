#!/bin/bash

# Date stamp
DATE=$(date +%Y%m%d-%H%M%S)

# Backup directory
BACKUP_DIR="$HOME/sanusbio-backups/$DATE"
MYSQL_PWD=$(cat ~/.sanusbio-db-pass)

# Create directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo "Creating database backup..."

podman exec sanusbio-db mysqldump \
    --no-tablespaces \
    -u sanusbio \
    -p"$MYSQL_PWD" \
    sanusbio \
    > "$BACKUP_DIR/sanusbio-database-$DATE.sql"

echo "Creating uploads backup..."

tar -czf "$BACKUP_DIR/sanusbio-uploads-$DATE.tar.gz" \
    -C "$HOME/.local/share/containers/storage/volumes/sanusbio-app_uploads_data/_data" .

clear

echo "Backup complete."
echo "Files saved to:"
echo "$BACKUP_DIR"

ls -lh "$BACKUP_DIR"