# systemd drop-in notes (not a unit): PostgreSQL
#
# Use the distro postgresql.service (apt/dnf package). Do not ship a second
# Postgres unit that fights the package manager.
#
# After install:
#   1. Install deploy/postgres/listen-localhost.conf into conf.d
#   2. Merge deploy/postgres/pg_hba.conf.snippet (loopback only)
#   3. systemctl enable --now postgresql
#   4. Confirm `ss -ltnp | grep 5432` shows 127.0.0.1 / ::1 only
