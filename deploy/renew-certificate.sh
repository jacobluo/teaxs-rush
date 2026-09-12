#!/bin/sh
# Installed as /etc/letsencrypt/renewal-hooks/deploy/texas-nginx.sh.
if [ "$RENEWED_LINEAGE" = /etc/letsencrypt/live/texas.webuddy.cc ]; then
    nginx -t && systemctl reload nginx
fi
