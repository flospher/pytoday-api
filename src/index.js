export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const userAgents = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
    ];
    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

    const headers = {
      "User-Agent": randomUA,
      "Accept": "*/*",
      "Cache-Control": "no-cache"
    };

    try {
      // IMAGE GENERATION
      if (path.startsWith("/image") || path.startsWith("/img")) {
        let prompt = url.searchParams.get("prompt") || url.searchParams.get("q");
        if (!prompt && path.length > 7) {
          prompt = decodeURIComponent(path.substring(7));
        }
        if (!prompt) {
          return new Response("Missing prompt → /image/a cat wearing sunglasses", { status: 400, headers: corsHeaders });
        }

        const params = new URLSearchParams(url.searchParams);
        params.set("nologo", "true");
        params.set("enhance", "true");
        params.set("private", "true");
        if (!params.get("model")) params.set("model", "flux");

        const target = "https://image.pollinations.ai/prompt/" + encodeURIComponent(prompt) + "?" + params;
        const res = await fetch(target, { headers });
        const buffer = await res.arrayBuffer();

        return new Response(buffer, {
          headers: {
            ...corsHeaders,
            "Content-Type": "image/jpeg",
            "Cache-Control": "public, max-age=" + (env.CACHE_TTL || 31536000)
          }
        });
      }

      // TEXT GENERATION
      if (path.startsWith("/text")) {
        let prompt = path.length > 6 ? decodeURIComponent(path.substring(6)) : "Hello";
        const params = new URLSearchParams(url.searchParams);
        const target = "https://text.pollinations.ai/" + encodeURIComponent(prompt) + "?" + params;
        const res = await fetch(target, { headers });
        const text = await res.text();

        return new Response(text, {
          headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" }
        });
      }

      // OPENAI COMPATIBLE CHAT
      if (path === "/chat" || path === "/openai" || path === "/v1/chat/completions") {
        if (request.method !== "POST") {
          return new Response("Use POST method", { status: 405, headers: corsHeaders });
        }
        const payload = await request.json();
        const res = await fetch("https://text.pollinations.ai/openai", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // AUDIO TTS
      if (path.startsWith("/audio")) {
        const text = path.length > 7 ? decodeURIComponent(path.substring(7)) : "Hello world";
        const voice = url.searchParams.get("voice") || "alloy";
        const target = "https://text.pollinations.ai/" + encodeURIComponent(text) + "?model=openai-audio&voice=" + voice;
        const res = await fetch(target, { headers });
        const buffer = await res.arrayBuffer();

        return new Response(buffer, {
          headers: { ...corsHeaders, "Content-Type": "audio/mpeg" }
        });
      }

      // HOME PAGE
      return new Response(`
Pollinations.ai Proxy API – LIVE & UNLIMITED

/image/beautiful girl in cyberpunk city
/text/Write a love poem
POST /chat → OpenAI compatible
/audio/Hello world?voice=nova

No API key • No rate limits • Forever yours
      `.trim(), {
        headers: { ...corsHeaders, "Content-Type": "text/plain" }
      });

    } catch (e) {
      return new Response("Error: " + e.message, { status: 500, headers: corsHeaders });
    }
  }
};
