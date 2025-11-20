const PROXIES = env.PROXIES.map(p => {
  const [host, port, user, pass] = p.split(":");
  return { host, port: Number(port), user, pass };
});

let proxyIndex = 0;

function getNextProxy() {
  const proxy = PROXIES[proxyIndex % PROXIES.length];
  proxyIndex++;
  return proxy;
}

async function fetchWithRetry(url, options = {}) {
  // Try direct first (fastest)
  try {
    const res = await fetch(url, {
      ...options,
      headers: { ...options.headers, "User-Agent": "Mozilla/5.0" }
    });
    if (res.ok) return res;
  } catch (e) {}

  // If direct fails, rotate through proxies using free public proxy trick
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 300));
    try {
      const proxy = getNextProxy();
      const auth = btoa(`${proxy.user}:${proxy.pass}`);
      const res = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          "User-Agent": "Mozilla/5.0",
          "Proxy-Authorization": `Basic ${auth}`
        }
      });
      if (res.ok) return res;
    } catch (e) {}
  }
  throw new Error("All attempts failed");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    try {
      // === IMAGE GENERATION ===
      if (path.startsWith("/image") || path.startsWith("/img")) {
        let prompt = url.searchParams.get("prompt") || url.searchParams.get("q");
        if (!prompt) prompt = decodeURIComponent(path.slice(path.indexOf("/", 1) + 1) || path.slice(6));
        if (!prompt) return new Response("Missing prompt", { status: 400, headers: cors });

        const params = new URLSearchParams(url.searchParams);
        params.set("nologo", "true");
        params.set("enhance", "true");
        params.set("private", "true");
        if (!params.has("model")) params.set("model", "flux");

        const targetUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;
        const res = await fetchWithRetry(targetUrl);
        const image = await res.arrayBuffer();

        return new Response(image, {
          headers: {
            ...cors,
            "Content-Type": "image/jpeg",
            "Cache-Control": `public, max-age=${env.CACHE_TTL}`
          }
        });
      }

      // === TEXT GENERATION ===
      if (path.startsWith("/text")) {
        const prompt = decodeURIComponent(path.slice(6)) || "Hello";
        const params = new URLSearchParams(url.searchParams);
        const targetUrl = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?${params}`;
        const res = await fetchWithRetry(targetUrl);
        const text = await res.text();

        return new Response(text, {
          headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" }
        });
      }

      // === OPENAI CHAT COMPATIBLE ===
      if (path === "/chat" || path === "/openai" || path === "/v1/chat/completions") {
        if (request.method !== "POST") return new Response("POST required", { status: 405 });
        const body = await request
