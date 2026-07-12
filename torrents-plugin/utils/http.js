// Parse an SDK http response body that may arrive as a JSON string OR an already-parsed object. Dedupes the
// `typeof res.data === 'string' ? JSON.parse(res.data) : res.data` pattern repeated across every call.
export function parseJson(res) {
  if (!res || res.data == null) return null;
  return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
}
