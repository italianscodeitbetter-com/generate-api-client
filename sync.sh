#!/bin/bash
set -e

# Check if required environment variables are set
if [ -z "$SOURCE_DB_URL" ]; then
    echo "Error: SOURCE_DB_URL environment variable is not set"
    exit 1
fi

if [ -z "$TARGET_DB_URL" ]; then
    echo "Error: TARGET_DB_URL environment variable is not set"
    exit 1
fi

echo "Starting database sync..."
echo "Source: $SOURCE_DB_URL"
echo "Target: $TARGET_DB_URL"

# Dump from source database
echo "Dumping from source database..."
pg_dump \
    -Fc \
    -v \
    -d "$SOURCE_DB_URL" \
    -n public \
    -f db_dump.bak

if [ ! -f db_dump.bak ]; then
    echo "Error: Failed to create database dump"
    exit 1
fi

echo "Dump completed successfully"

# Restore to target database
echo "Restoring to target database..."
pg_restore \
    -d "$TARGET_DB_URL" \
    -v \
    ./db_dump.bak \
    && echo "-complete-"

if [ $? -eq 0 ]; then
    echo "Database sync completed successfully"
    # Clean up dump file
    rm -f db_dump.bak
else
    echo "Error: Failed to restore database"
    exit 1
fi
