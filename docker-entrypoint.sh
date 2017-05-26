#!/bin/bash -e
j2 /config/master.json.j2 > /config/master.json
exec "$@"
