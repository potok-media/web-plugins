import { PotokSDK } from 'potok-sdk';

// Parse an SDK http response body that may arrive as a JSON string OR an already-parsed object. Dedupes the
// `typeof res.data === 'string' ? JSON.parse(res.data) : res.data` pattern repeated across every call.
export function parseJson(res) {
  if (!res || res.data == null) return null;
  return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
}

export function get(url, headers, timeoutMs) {
  return PotokSDK.http.request({ url, method: 'GET', headers, timeoutMs });
}

export function post(url, body, headers, timeoutMs) {
  return PotokSDK.http.request({ url, method: 'POST', body, headers, timeoutMs });
}

export async function streamPost(url, body, headers, timeoutMs, onEvent) {
  let buffer = '';
  const events = [];
  const consume = (flush = false) => {
    const lines = buffer.split('\n');
    const remainder = lines.pop() ?? '';
    buffer = flush ? '' : remainder;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event;
      try {
        event = JSON.parse(trimmed);
      } catch {
        continue;
      }
      events.push(event);
      onEvent?.(event);
    }
    if (flush && remainder.trim()) {
      let event;
      try {
        event = JSON.parse(remainder.trim());
      } catch {
        return;
      }
      events.push(event);
      onEvent?.(event);
    }
  };
  const response = await PotokSDK.http.stream(
    { url, method: 'POST', body, headers, timeoutMs },
    (chunk) => {
      buffer += String(chunk ?? '');
      consume(false);
    },
  );
  consume(true);
  return { ...response, data: events };
}
