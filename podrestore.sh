cd ~/sanusbio-app
podman-compose down
podman-compose up -d --build

# Or
podman-compose down && podman-compose up -d --build --force-recreate

# Executing the following will load new sql data that was written
# This can be modified as needed for new sql files that are added to the init directory
podman exec -e MYSQL_PWD="$(cat ~/.sanusbio-db-pass)" -i sanusbio-db mysql -u sanusbio sanusbio < init/

# For Google Drive backup via rclone
rclone copy ~/sanusbio-backups gdrive:"Server Backups"
