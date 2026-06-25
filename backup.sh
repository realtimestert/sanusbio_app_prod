#!/bin/bash
DATE=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="$HOME/sanusbio-backups/$DATE"
mkdir -p "$BACKUP_DIR"
MYSQL_PWD=$(cat ~/.sanusbio-db-pass)

echo "Creating database backup..."
podman exec -e MYSQL_PWD="$MYSQL_PWD" sanusbio-db mysqldump \
    --no-tablespaces \
    -u sanusbio \
    sanusbio \
    > "$BACKUP_DIR/sanusbio-database-$DATE.sql"

echo "Creating signature backup..."
podman exec -e MYSQL_PWD="$MYSQL_PWD" sanusbio-db mysqldump \
    --no-tablespaces \
    -u sanusbio \
    sanusbio \
    room_cleaning_report \
    > "$BACKUP_DIR/sanusbio-signatures-$DATE.sql"

echo "Creating uploads backup..."
tar -czf "$BACKUP_DIR/sanusbio-uploads-$DATE.tar.gz" \
    -C "$HOME/.local/share/containers/storage/volumes/sanusbio-app_uploads_data/_data" .

echo "Backup complete."
echo "Files saved to:"
echo "$BACKUP_DIR"
ls -lh "$BACKUP_DIR"