export function isJwt(token) {
  const parts = String(token ?? "").split(".");
  return (
    parts.length === 3 &&
    parts[0].startsWith("eyJ") &&
    parts.every((part) => part.length > 0)
  );
}

export function authAdminHeaders(serviceKey, extra = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/** PostgREST: never send opaque sb_secret_* / sb_publishable_* as Bearer. */
export function postgrestHeaders({ apikey, accessToken, extra = {} }) {
  const headers = {
    apikey,
    "Content-Type": "application/json",
    ...extra,
  };
  if (accessToken && isJwt(accessToken)) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return headers;
}
