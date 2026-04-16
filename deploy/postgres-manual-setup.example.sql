-- Run on the VPS as postgres superuser once (adjust names/passwords).
-- Example: sudo -u postgres psql -f postgres-manual-setup.example.sql
-- Do not commit a version of this file with a real password.

CREATE USER lumoref_app WITH PASSWORD 'CHANGE_ME_DB_PASSWORD';
CREATE DATABASE lumoref OWNER lumoref_app;
GRANT ALL PRIVILEGES ON DATABASE lumoref TO lumoref_app;
