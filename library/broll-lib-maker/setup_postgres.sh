#!/usr/bin/env bash
# One-time local Postgres + pgvector setup for the broll engine.
# Run:  sudo bash setup_postgres.sh
set -euo pipefail

apt-get install -y postgresql postgresql-16-pgvector
systemctl enable --now postgresql

sudo -u postgres psql <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'broll') THEN
    CREATE ROLE broll LOGIN PASSWORD 'broll';
  END IF;
END $$;
SQL
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='broll'" | grep -q 1 \
  || sudo -u postgres createdb -O broll broll
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='broll_test'" | grep -q 1 \
  || sudo -u postgres createdb -O broll broll_test
sudo -u postgres psql -d broll -c "CREATE EXTENSION IF NOT EXISTS vector;"
sudo -u postgres psql -d broll_test -c "CREATE EXTENSION IF NOT EXISTS vector;"

echo "OK — postgres running, databases 'broll' and 'broll_test' ready (user broll / password broll)"
