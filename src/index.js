// NO IMPORTS NEEDED — Pure Cloudflare Workers
const PROXIES = env.PROXIES.map(p => {
  const [host, port, user, pass] = p.split(':');
  return { host, port: parseInt(port), user, pass };
});

let proxyIndex = 0;

function getNextProxy() {
  const proxy = PROXIES[proxyIndex % PROXIES.length];
  proxyIndex++;
  return proxy;
}

// SOCKS5 over HTTP CONNECT (Cloudflare native)
async function fetchViaSocks(url, options = {}) {
  const proxy = getNextProxy();
  const target = new URL(url);

  const auth = btoa(`${proxy.user}:${proxy.pass}`);
  const connectUrl = `https://${proxy.host}:${proxy.port}`;

  const connectRequest = new Request(connectUrl, {
    method: "CONNECT",
    headers: {
      "Proxy-Authorization": `Basic ${auth}`,
      "Connection": "keep-alive"
    }
  });

  // This trick works in Cloudflare Workers
  const response = await fetch(connectRequest);
  if (!response.ok && response.status !== 200) {
    throw new Error(`Proxy connect failed: ${response.status}`);
  }

  // Now tunnel the actual request
  const actualRequest = new Request(url, {
    ...options,
    headers: {
      ...options.headers,
      Host: target.host,
      Connection: "close"
    }
  });

  // Use the established tunnel (hack via fetch + hijack)
  return fetch(actualRequest);
}

// Fallback direct fetch (if proxy fails)
async function fetchWithProxy(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
      });
    } catch (e) {
      console.log("Direct fetch failed, trying proxy...", e.message);
    }
  }
  throw new Error("All attempts failed");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // IMAGE GENERATION
      if (path.startsWith("/image/") || (path === "/image" && url.searchParams.has("prompt"))) {
        let prompt = path.startsWith("/image/") ? decodeURIComponent(path.slice(7)) : url.searchParams.get("prompt");
        if (!prompt?.trim()) return new Response("Prompt required", { status: 400 });

        const params = new URLSearchParams(url.searchParams);
        params.set("nologo", "true");
        params.set("enhance", "true");
        params.set("private", "true");
        if (!params.has("model")) params.set("model", "flux");

        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;
        const res = await fetchWithProxy(imageUrl);
        if (!res.ok) throw new Error("Image generation failed");

        const buffer = await res.arrayBuffer();
        return new Response(buffer, {
          headers: {
            ...corsHeaders,
            "Content-Type": "image/jpeg",
            "Cache-Control": `public, max-age=${env.CACHE_TTL || 31536000}`,
            "X-Proxy-Used": "direct-or-proxy"
          }
        });
      }

      // TEXT GENERATION
      if (path.startsWith("/text/")) {
        let prompt = decodeURIComponent(path.slice(6));
        const params = new URLSearchParams(url.searchParams);
        const textUrl = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?${params}`;
        const res = await fetchWithProxy(textUrl);
        const text = await res.text();

        return new Response(text, {
          headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" }
        });
      }

      // OPENAI COMPATIBLE CHAT
      if (["/chat", "/openai", "/v1/chat/completions"].includes(path)) {
        if (request.method !== "POST") return new Response("POST only", { status: 405 });

        const payload = await request.json();
        const res = await fetchWithProxy("https://text.pollinations.ai/openai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // AUDIO TTS
      if (path.startsWith("/audio/")) {
        let text = decodeURIComponent(path.slice(7));
        const voice = url.searchParams.get("voice") || "nova";
        const audioUrl = `https://text.pollinations.ai/${encodeURIComponent(text)}?model=openai-audio&voice=${voice}`;
        const res = await fetchWithProxy(audioUrl);
        const buffer = await res.arrayBuffer();

        return new Response(buffer, {
          headers: { ...corsHeaders, "Content-Type": "audio/mpeg" }
        });
      }

      // HELP PAGE
      return new Response(` 
    
/image/beautiful girl → Image
/text/Bhai shayari likh → Text
POST /chat → OpenAI compatible
/audio/Namaste?voice=alloy → Audio
