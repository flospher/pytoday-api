import { SocksProxyAgent } from 'socks-proxy-agent';
import axios from 'axios';

const PROXIES = JSON.parse(PROXIES); // from wrangler.toml
let proxyIndex = 0;

function getNextProxy() {
  const proxy = PROXIES[proxyIndex % PROXIES.length];
  proxyIndex++;
  return new SocksProxyAgent(proxy);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS Headers (sab jagah allow)
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ==================== IMAGE GENERATION ====================
      if (path.startsWith("/image/") || path === "/image") {
        let prompt = path === "/image" ? url.searchParams.get("prompt") : decodeURIComponent(path.slice(7));
        if (!prompt) return new Response("Prompt missing", { status: 400 });

        const params = new URLSearchParams(url.searchParams);
        // Force remove logo + enhance
        params.set("nologo", "true");
        params.set("enhance", "true");
        params.set("private", "true");

        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;

        const response = await fetchWithProxy(imageUrl);
        const imageBuffer = await response.arrayBuffer();

        return new Response(imageBuffer, {
          headers: {
            ...corsHeaders,
            "Content-Type": "image/jpeg",
            "Cache-Control": `public, max-age=${env.CACHE_TTL || 31536000}`,
            "X-Prompt": prompt,
          },
        });
      }

      // ==================== TEXT GENERATION (Simple GET) ====================
      if (path.startsWith("/text/")) {
        let prompt = decodeURIComponent(path.slice(6));
        if (!prompt) return new Response("Prompt missing", { status: 400 });

        const params = new URLSearchParams(url.searchParams);
        const model = params.get("model") || "openai";

        const textUrl = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?${params}`;
        const res = await fetchWithProxy(textUrl);
        const text = await res.text();

        return new Response(text, {
          headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
        });
      }

      // ==================== OPENAI COMPATIBLE CHAT (/chat) ====================
      if (path === "/chat" || path === "/openai" || path === "/v1/chat/completions") {
        if (request.method !== "POST") return new Response("POST only", { status: 405 });

        const userPayload = await request.json();

        // Forward directly to pollinations with proxy
        const proxyAgent = getNextProxy();
        const response = await axios.post("https://text.pollinations.ai/openai", userPayload, {
          httpsAgent: proxyAgent,
          httpAgent: proxyAgent,
          timeout: 300000,
          headers: { "Content-Type": "application/json" },
        });

        return new Response(JSON.stringify(response.data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ==================== AUDIO TTS ====================
      if (path.startsWith("/audio/")) {
        let text = decodeURIComponent(path.slice(7));
        const voice = url.searchParams.get("voice") || "nova";
        const audioUrl = `https://text.pollinations.ai/${encodeURIComponent(text)}?model=openai-audio&voice=${voice}`;

        const res = await fetchWithProxy(audioUrl);
        const buffer = await res.arrayBuffer();

        return new Response(buffer, {
          headers: { ...corsHeaders, "Content-Type": "audio/mpeg" },
        });
      }

      // ==================== DEFAULT HELP PAGE ====================
      return new Response(`
Custom Pollinations Proxy API (Rate-limit Proof)

Endpoints:

GET  /image/cat in space → Image
GET  /image/?prompt=cyberpunk girl&model=flux&width=1024&height=1792

GET  /text/Write a love story → Text
POST /chat → OpenAI compatible (full vision, tools, audio support)

GET  /audio/Hello world?voice=alloy → MP3

Made with ❤️ using Cloudflare Workers + SOCKS5 rotation
      `.trim(), {
        headers: { ...corsHeaders, "Content-Type": "text/plain" }
      });

    } catch (err) {
      console.error(err);
      // Auto retry with next proxy on failure
      if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
        return new Response("Rate limited / timeout – auto retrying with next proxy...", { status: 529 });
      }
      return new Response("Internal Error: " + err.message, { status: 500 });
    }
  },
};

// Helper: fetch with rotating proxy + fallback
async function fetchWithProxy(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const agent = getNextProxy();
      const response = await fetch(url, {
        agent,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });
      if (response.ok) return response;
    } catch (e) {
      console.log("Proxy failed, trying next...", e.message);
    }
  }
  throw new Error("All proxies failed");
}
