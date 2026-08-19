cd ~/sanusbio-app
podman-compose down
podman-compose up -d --build

# Or
podman-compose down && podman-compose up -d --build --force-recreate

# Executing the following will load new sql data that was written
# This can be modified as needed for new sql files that are added to the init directory
podman exec -e MYSQL_PWD="$(cat ~/.sanusbio-db-pass)" -i sanusbio-db mysql -u sanusbio sanusbio < init/24_room_light_history.sql

# 2. Room light history first (creates the schedule timeline)
node import-room-light-history.js --dry-run /var/home/bazzite/sanusbio-app/Light_Cycle_History.csv
node import-room-light-history.js --import  /var/home/bazzite/sanusbio-app/Light_Cycle_History.csv

# 3. Location history + continuous-period recompute
node import-light-location-history.js --dry-run /var/home/bazzite/sanusbio-app/Light_change.csv
node import-light-location-history.js --import  /var/home/bazzite/sanusbio-app/Light_change.csv

# 4. Rebuild / restart
podman-compose down && up -d --build --force-recreate