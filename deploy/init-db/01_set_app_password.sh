#!/bin/sh
set -e

if [ -n "$DB_APP_PASSWORD" ]; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    ALTER ROLE devcore_app WITH PASSWORD '$DB_APP_PASSWORD';
EOSQL
fi
