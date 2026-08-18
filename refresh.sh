podman cp QR005-full.csv sanusbio-app:/app/QR005-full.csv   # after each Smartsheet export

podman exec -it \
  -e DB_HOST=db -e DB_USER=sanusbio \
  -e DB_PASS="$(cat ~/.sanusbio-db-pass)" -e DB_NAME=sanusbio \
  sanusbio-app \
  node import-csv.js --update /app/QR005-full.csv

podman exec -it \
  -e DB_HOST=db -e DB_USER=sanusbio \
  -e DB_PASS="$(cat ~/.sanusbio-db-pass)" -e DB_NAME=sanusbio \
  sanusbio-app \
  node import-maternity.js --import /app/QR005-full.csv