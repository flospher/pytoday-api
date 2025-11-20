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
      // Random User-Agent to avoid rate limits
      const agents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"
      ];
      const randomAgent = agents[Math.floor(Math.random() * agents.length)];

      const headers = {
        "User-Agent": randomAgent,
        "Accept": "*/*",
        "Cache-Control": "no-cache"
      };

      // IMAGE GENERATION
      if (path.startsWith("/image") || path.startsWith("/img")) {
        let prompt = url.searchParams.get("prompt") || url.searchParams.get("q");
        if (!prompt && path.length > 6) prompt = decodeURIComponent(path.slice(7));

        if (!prompt) {
          return new Response("Add a prompt: /image/a cat wearing sunglasses", { status: 400, headers: corsHeaders });
        }

        const params = new URLSearchParams(url.searchParams);
        params.set("nologo", "true");
        params.set("enhance", "true");
        params.set("private", "true");
        if (!params.get("model")) params.set("model", "flux");

        const target = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;

        const res = await fetch(target, { headers });
        const image = await res.arrayBuffer();

        return new Response(image, {
          headers: {
            ...corsHeaders,
            "Content-Type": "image/jpeg",
            "Cache-Control": `public, max-age=${env.CACHE_TTL || 31536000}`
          }
        });
      }

      // TEXT GENERATION
      if (path.startsWith("/text")) {
        let prompt = decodeURIComponent(path.slice(6));
        if (!prompt) prompt = "Hello world";

        const params = new URLSearchParams(url.searchParams);
        const target = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?${params}`;

        const res = await fetch(target, { headers });
        const text = await res.text();

        return new Response(text, {
          headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" }
        });
      }

      // OPENAI COMPATIBLE CHAT
      if (path === "/chat" || path === "/openai" || path === "/v1/chat/completions") {
        if (request.method !== "POST") {
          return new Response("Use POST with JSON body", { status: 405, headers: corsHeaders });
        }

        const body = await request.json();
        const res = await fetch("https://text.pollinations.ai/openai", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body)
        });

        const data = await res.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // AUDIO TTS
      if (path.startsWith("/audio")) {
        const text = decodeURIComponent(path.slice(7)) || "Hello world";
        const voice = url.searchParams.get("voice") || "alloy";
        const target = `https://text.pollinations.ai/${encodeURIComponent(text)}?model=openai-audio&voice=${voice}`;

        const res = await fetch(target, { headers });
        const audio = await res.arrayBuffer();

        return new Response(audio, {
          headers: { ...corsHeaders, "Content-Type": "audio/mpeg
