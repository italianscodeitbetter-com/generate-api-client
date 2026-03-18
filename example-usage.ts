/**
 * Example usage of the generated API client.
 * Run: npx tsx example-usage.ts
 *
 * Prerequisites:
 * 1. npm run generate
 * 2. Set API_TOKEN env var (or call setAuthToken)
 */

import { setAuthToken, apiClient } from "./api/index.js";

async function main() {
  const token = process.env.API_TOKEN;
  if (token) {
    setAuthToken(token);
  }

  try {
    const listRes = await apiClient.allegati.list({ page: 1, size: 10 });
    console.log("Allegati count:", listRes.data.count);
    console.log("First result:", listRes.data.results[0]);

    if (listRes.data.results[0]?.id) {
      const detailRes = await apiClient.allegati.read({
        id: listRes.data.results[0].id,
      });
      console.log("Detail:", detailRes.data);
    }
  } catch (err: unknown) {
    const axiosErr = err as { response?: { status?: number; data?: unknown } };
    if (axiosErr?.response?.status === 401) {
      console.log("401 Unauthorized - set API_TOKEN to authenticate");
    } else {
      console.error("API error:", err);
    }
  }
}

main();
