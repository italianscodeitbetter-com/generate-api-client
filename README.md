# Generate API Client

Generate a strictly-typed TypeScript API client from Swagger/OpenAPI docs, using Axios and organized by context (tags).

## API Client Generator

### Usage

```bash
npm run generate
```

With options:

```bash
npm run generate -- --url https://api-gss.icib.dev/docs/?format=openapi --out api
```

### Output

The generator creates an `api/` folder:

```
api/
├── client.ts          # Axios instance with Bearer auth
├── types/index.ts     # TypeScript interfaces from schema definitions
├── contexts/          # One file per API context (tag)
│   ├── allegati.ts
│   ├── articolo.ts
│   └── ...
└── index.ts           # Re-exports all contexts and types
```

### Using the generated client

```typescript
import { setAuthToken, allegatiList, allegatiRead } from "./api/index.js";

setAuthToken(process.env.GSS_API_TOKEN);

const res = await allegatiList({ page: 1, size: 10 });
const detail = await allegatiRead({ id: res.data.results[0].id });
```

---

# PostgreSQL Database Sync

This script syncs a PostgreSQL database from a source to a target using `pg_dump` and `pg_restore`.

## Usage

### Using Docker

Build the Docker image:
```bash
docker build -t postgres-sync .
```

Run the sync:
```bash
docker run --rm \
  -e SOURCE_DB_URL="postgresql://user:password@host:port/database" \
  -e TARGET_DB_URL="postgresql://user:password@host:port/database" \
  postgres-sync
```

### Using the script directly

Make the script executable:
```bash
chmod +x sync.sh
```

Run with environment variables:
```bash
SOURCE_DB_URL="postgresql://user:password@host:port/database" \
TARGET_DB_URL="postgresql://user:password@host:port/database" \
./sync.sh
```

## Environment Variables

- `SOURCE_DB_URL`: The source database connection string
- `TARGET_DB_URL`: The target database connection string where the dump will be restored

## Notes

- The script uses `pg_dump` with format `-Fc` (custom format) for efficient dumps
- Only the `public` schema is synced (`-n public`)
- The dump file (`db_dump.bak`) is automatically cleaned up after successful restore
- The script will exit with an error code if any step fails
