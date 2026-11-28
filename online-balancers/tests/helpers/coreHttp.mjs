export function createCoreHttp(fetchImpl = (...args) => globalThis.fetch(...args)) {
  const send = request => fetchImpl(request.url, {
    method: request.method ?? 'GET',
    headers: request.headers,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  });

  return {
    async request(request) {
      const response = await send(request);
      return {
        status: response.status ?? (response.ok ? 200 : 500),
        headers: {},
        data: await response.json(),
      };
    },
    async stream(request, onChunk) {
      const response = await send(request);
      const reader = response.body?.getReader?.();
      if (!reader) {
        const data = await response.json();
        onChunk(`${JSON.stringify({ type: 'done', response: data })}\n`);
        return data;
      }
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        onChunk(decoder.decode(value, { stream: true }));
      }
      const tail = decoder.decode();
      if (tail) onChunk(tail);
    },
  };
}
