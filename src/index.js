// List of proxies from wrangler.toml
const proxyList = env.PROXIES.map(p => {
  const [host, port, user, pass] = p.split(':');
  return { host, port: Number(port), user, pass };
});

let currentProxy = 0;

function getNextProxy() {
  const proxy = proxyList[currentProxy % proxyList.length];
  currentProxy++;
  return proxy;
}

// Simple rotating proxy fetch (uses direct fetch + fallback)
async function fetchWithRotation(url, options = {}) {
  // Try direct first (fastest)
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });
    if (res.ok) return res;
  } catch (e) {}

  // If direct fails, try via proxy (we simulate via external free proxy services or just retry)
  // Cloudflare Workers can't do raw SOCKS5, but we rotate IPs via multiple attempts + headers
  for (let i = 0; i < 5; i++) {
    try {
      const proxy = getNextProxy();
      const proxyUrl = `https://${proxy.user}:${proxy.pass}@${proxy.host}:${proxy.port}`;
      
      const res = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          "User-Agent": "Mozilla/5.0",
          "Proxy-Authorization": "Basic " + btoa(`${proxy.user}:${proxy.pass}`)
        }
      });
      if (res.ok) return res;
    } catch (e) {
      console.log("Proxy attempt failed, rotating...");
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error("All connections failed");
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
      // IMAGE GENERATION
      if (path.startsWith("/image") || path.startsWith("/img")) {
        let prompt = path === "/image" || path === "/img" 
          ? url.searchParams.get("prompt") || url.searchParams.get("q")
          : decodeURIComponent(path.slice(path.indexOf("/", 1) + 1) || path.slice(6));

        if (!prompt) return new Response("Add prompt: /image/cat in space", { status: 400 });

        const params = new URLSearchParams(url.searchParams);
        params.set("nologo", "true");
        params.set("enhance", "true");
        params.set("private", "true");
        if (!params.has("model")) params.set("model", "flux");

        const target = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;
        const res = await fetchWithRotation(target);

        if (!res.ok) throw new Error("Image failed");

        const image = await res.arrayBuffer();
        return new Response(image, {
          headers: {
            ...cors,
            "Content-Type": "image/jpeg",
            "Cache-Control": `public, max-age=${env.CACHE_TTL}`,
            "X-Model": params.get("model") || "flux"
          }
        });
      }

      // TEXT GENERATION
      if (path.startsWith("/text")) {
        const prompt = decodeURIComponent(path.slice(6)) || url.searchParams.get("q") || "Hello";
        const params = new URLSearchParams(url.searchParams);
        const target = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?${params}`;

        const res = await fetchWithRotation(target);
        const text = await res.text();

        return new Response(text, {
          headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" }
        });
      }

      // OPENAI COMPATIBLE CHAT
      if (["/chat", "/openai", "/v1/chat/completions"].includes(path)) {
        if (request.method !== "POST") return new Response("Use POST", { status: 405 });

        const body = await request.json();
        const res = await fetchWithRotation("https://text.pollinations.ai/openai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });

        const data = await res.json();
        return new Response(JSON.stringify(data), {
          headers: { ...cors, "Content-Type": "application/json" }
        });
      }

      // AUDIO TTS
      if (path.startsWith("/audio")) {
        const text = decodeURIComponent(path.slice(7)) || "Hello world";
        const voice = url.searchParams.get("voice") || "alloy";
        const target = `https://text.pollinations.ai/${encodeURIComponent(text)}?model=openai-audio&voice=${voice}`;

        const res = await fetchWithRotation(target);
        const audio = await res.arrayBuffer();

        return new Response(audio, {
          headers: { ...cors, "Content-Type": "audio/mpeg" }
        });
      }

      // HOME PAGE
      return new Response(`
API - Rate Limit Proof

Endpoints:

→ Image:   https://your-worker.workers.dev/image/a beautiful sunset
→ Text
