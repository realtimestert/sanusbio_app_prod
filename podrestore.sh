#!/bin/bash
podman-compose up -d --build --force-recreate app

cd ~/sanusbio-app
podman-compose down
podman-compose up -d --build