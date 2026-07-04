let tunnelWs = null;
const pendingRequests = new Map();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // --- API Endpoint: Simpan Config dari Web UI ke KV ---
    if (url.pathname === '/api/config' && request.method === 'POST') {
      try {
        const body = await request.json();
        if (body.port) await env.accounts_kv.put('LOCAL_PORT', body.port.toString());
        if (body.token) await env.accounts_kv.put('AUTH_TOKEN', body.token);
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { 
          status: 500, headers: { "Access-Control-Allow-Origin": "*" } 
        });
      }
    }

    // Handle CORS preflight untuk Web UI
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    // Ambil Config dari KV accounts_kv
    const AUTH_TOKEN = (await env.accounts_kv?.get('AUTH_TOKEN')) || "default_token";
    const LOCAL_PORT = (await env.accounts_kv?.get('LOCAL_PORT')) || "8080";

    // --- 1. Endpoint instalasi otomatis untuk Termux ---
    if (url.pathname === '/setup') {
      const script = `#!/bin/bash
echo -e "\\e[1;34m[+]===============================================[+]\\e[0m"
echo -e "\\e[1;34m |      ONTIME TERMUX TUNNEL INSTALLER           |\\e[0m"
echo -e "\\e[1;34m[+]===============================================[+]\\e[0m"
echo -e "\\e[1;32m[+] Menyiapkan Tunnel Localhost ke Cloudflare Worker...\\e[0m"

echo -e "\\e[1;33m[*] Menginstall Node.js...\\e[0m"
pkg install nodejs -y > /dev/null 2>&1

mkdir -p ~/.termux_tunnel
cd ~/.termux_tunnel

if [ ! -f package.json ]; then
  npm init -y > /dev/null 2>&1
fi

echo -e "\\e[1;33m[*] Menginstall modul WebSocket...\\e[0m"
npm install ws > /dev/null 2>&1

cat << 'EOF' > ~/.termux_tunnel/tunnel.js
const WebSocket = require('ws');
const http = require('http');

const WORKER_URL = '${url.origin}';
const WS_URL = WORKER_URL.replace('http', 'ws') + '/_ws';
const AUTH_TOKEN = '${AUTH_TOKEN}';
const LOCAL_PORT = ${LOCAL_PORT};

function connect() {
  console.log('[*] Menghubungkan ke ' + WS_URL);
  const ws = new WebSocket(WS_URL, {
    headers: { 'Authorization': 'Bearer ' + AUTH_TOKEN }
  });

  ws.on('open', () => {
    console.log('\\x1b[32m[+] Tunnel terhubung! Publik URL Anda:\\x1b[0m ' + WORKER_URL);
    console.log('\\x1b[36m[*] Meneruskan traffic publik ke localhost:\\x1b[0m' + LOCAL_PORT);
  });

  ws.on('message', async (data) => {
    try {
      const reqData = JSON.parse(data.toString());
      
      const options = {
        hostname: '127.0.0.1',
        port: LOCAL_PORT,
        path: new URL(reqData.url).pathname + new URL(reqData.url).search,
        method: reqData.method,
        headers: reqData.headers
      };

      delete options.headers['host']; // Prevent host conflict

      const proxyReq = http.request(options, (proxyRes) => {
        let chunks = [];
        proxyRes.on('data', chunk => chunks.push(chunk));
        proxyRes.on('end', () => {
          const bodyBuffer = Buffer.concat(chunks);
          ws.send(JSON.stringify({
            id: reqData.id,
            status: proxyRes.statusCode,
            headers: proxyRes.headers,
            body: bodyBuffer.toString('base64')
          }));
        });
      });

      proxyReq.on('error', (err) => {
        ws.send(JSON.stringify({
          id: reqData.id,
          status: 502,
          headers: { 'Content-Type': 'text/plain' },
          body: Buffer.from('Bad Gateway: Local server error - ' + err.message).toString('base64')
        }));
      });

      if (reqData.body) {
        proxyReq.write(Buffer.from(reqData.body, 'base64'));
      }
      proxyReq.end();
      
    } catch(e) {
      console.error('[-] Error handling message:', e.message);
    }
  });

  ws.on('close', () => {
    console.log('[-] Koneksi terputus. Mencoba menyambung kembali dalam 5 detik...');
    setTimeout(connect, 5000);
  });
  
  ws.on('error', (err) => {
    console.error('[!] WebSocket Error:', err.message);
  });
}

connect();
EOF

if ! grep -q ".termux_tunnel/tunnel.js" ~/.bashrc; then
  echo "cd ~/.termux_tunnel && node tunnel.js &" >> ~/.bashrc
  echo -e "\\e[1;32m[+] Berhasil ditambahkan ke .bashrc\\e[0m"
fi

echo -e "\\e[1;32m[+] Instalasi Selesai! Menjalankan tunnel sekarang...\\e[0m"
cd ~/.termux_tunnel && node tunnel.js
`;
      return new Response(script, {
        headers: { 
          "Content-Type": "text/plain;charset=UTF-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*"
        },
      });
    }

    // --- 2. Endpoint WebSocket untuk Termux Tunnel Client ---
    if (url.pathname === '/_ws') {
      if (request.headers.get("Authorization") !== `Bearer ${AUTH_TOKEN}`) {
        return new Response("Unauthorized", { status: 401 });
      }
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }

      const webSocketPair = new WebSocketPair();
      const client = webSocketPair[0];
      const server = webSocketPair[1];
      server.accept();
      
      tunnelWs = server;
      server.addEventListener('message', event => {
        try {
          const data = JSON.parse(event.data);
          if (data.id && pendingRequests.has(data.id)) {
            pendingRequests.get(data.id)(data);
          }
        } catch (e) {}
      });
      
      server.addEventListener('close', () => {
        if (tunnelWs === server) tunnelWs = null;
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    // FALLBACK: Serve React UI if it's not a tunneled request?
    // Wait, if tunnelWs is connected, the user wants to forward the request to termux!
    // But if they visit the root URL in a browser to see the config UI, they shouldn't be forwarded to termux?
    // Actually, if tunnelWs is NOT connected, maybe we can serve the React UI.
    // Or we can say if they request `/ui`, we serve the React UI.
    // Let's just return env.ASSETS.fetch(request) if they request the root or index.html,
    // so they can configure the app!
    
    // --- 3. Routing Request Publik ke Localhost Termux ---
    if (!tunnelWs) {
      return new Response(
        "<h1>502 Bad Gateway</h1><p>Tunnel dari Termux belum terhubung.</p><p>Pastikan script Termux berjalan dan KV accounts_kv sudah terhubung.</p>", 
        { status: 502, headers: { "Content-Type": "text/html" } }
      );
    }

    const reqId = crypto.randomUUID();
    let reqBodyBase64 = null;
    
    if (request.body) {
      const buffer = await request.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      reqBodyBase64 = btoa(binary);
    }

    const reqData = {
      id: reqId,
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers.entries()),
      body: reqBodyBase64
    };

    const responsePromise = new Promise(resolve => {
      pendingRequests.set(reqId, resolve);
      setTimeout(() => {
        if (pendingRequests.has(reqId)) {
          pendingRequests.delete(reqId);
          resolve({ status: 504, headers: { "Content-Type": "text/plain" }, body: btoa("Gateway Timeout: Termux did not respond in 30s.") });
        }
      }, 30000);
    });

    try {
      tunnelWs.send(JSON.stringify(reqData));
    } catch (e) {
      return new Response("Failed to send request to tunnel", { status: 502 });
    }

    const resData = await responsePromise;
    pendingRequests.delete(reqId);

    let resBody = null;
    if (resData.body) {
      const binaryString = atob(resData.body);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      resBody = bytes;
    }

    return new Response(resBody, {
      status: resData.status,
      headers: resData.headers
    });
  },
};
