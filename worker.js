let tunnelWs = null;
const pendingRequests = new Map();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --- API Endpoint: Simpan Config dari Web UI ke KV ---
    if (url.pathname === '/api/config' && request.method === 'POST') {
      try {
        if (!env.accounts_kv) {
          throw new Error("KV 'accounts_kv' belum di-bind di Settings Cloudflare Pages Anda.");
        }
        const body = await request.json();
        if (body.port) await env.accounts_kv.put('LOCAL_PORT', body.port.toString());
        if (body.token) await env.accounts_kv.put('AUTH_TOKEN', body.token);
        
        // Simpan ke riwayat (saved configs)
        if (body.port && body.token) {
           let configs = [];
           try {
              const saved = await env.accounts_kv.get('SAVED_CONFIGS');
              if (saved) configs = JSON.parse(saved);
           } catch(e) {}
           if (!configs.find(c => c.port === body.port.toString() && c.token === body.token)) {
               configs.push({ id: Date.now().toString(), port: body.port.toString(), token: body.token });
               await env.accounts_kv.put('SAVED_CONFIGS', JSON.stringify(configs));
           }
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { 
          status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } 
        });
      }
    }

    // --- API Endpoint: Ambil daftar Config ---
    if (url.pathname === '/api/configs' && request.method === 'GET') {
      try {
         let configs = [];
         if (env.accounts_kv) {
            const saved = await env.accounts_kv.get('SAVED_CONFIGS');
            if (saved) configs = JSON.parse(saved);
         }
         return new Response(JSON.stringify(configs), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }});
      } catch(e) {
         return new Response("[]", { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }});
      }
    }

    // --- API Endpoint: Hapus Config ---
    if (url.pathname === '/api/configs' && request.method === 'DELETE') {
       try {
          if (!env.accounts_kv) throw new Error("KV missing");
          const body = await request.json();
          let configs = [];
          const saved = await env.accounts_kv.get('SAVED_CONFIGS');
          if (saved) configs = JSON.parse(saved);
          
          configs = configs.filter(c => c.id !== body.id);
          await env.accounts_kv.put('SAVED_CONFIGS', JSON.stringify(configs));
          
          return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }});
       } catch(e) {
          return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }});
       }
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    // Ambil Config dari KV accounts_kv (dengan fallback aman)
    let AUTH_TOKEN = "default_token";
    let LOCAL_PORT = "8080";
    if (env.accounts_kv) {
       AUTH_TOKEN = (await env.accounts_kv.get('AUTH_TOKEN')) || "default_token";
       LOCAL_PORT = (await env.accounts_kv.get('LOCAL_PORT')) || "8080";
    }

    // --- 1. Endpoint instalasi otomatis untuk Termux ---
    if (url.pathname === '/setup') {
      const script = `#!/bin/bash
echo -e "\\e[1;34m[+]===============================================[+]\\e[0m"
echo -e "\\e[1;34m |      ONTIME TERMUX TUNNEL INSTALLER           |\\e[0m"
echo -e "\\e[1;34m[+]===============================================[+]\\e[0m"
echo -e "\\e[1;32m[+] Menyiapkan Tunnel Localhost ke Cloudflare...\\e[0m"
echo -e "\\e[1;33m[*] Menginstall Node.js...\\e[0m"
pkg install nodejs -y > /dev/null 2>&1
mkdir -p ~/.termux_tunnel
cd ~/.termux_tunnel
if [ ! -f package.json ]; then
  npm init -y > /dev/null 2>&1
fi
echo -e "\\e[1;33m[*] Menginstall modul WebSocket & http-server...\\e[0m"
npm install ws http-server > /dev/null 2>&1

echo -e "\\e[1;33m[*] Memulai Web Server lokal di port ${LOCAL_PORT} (menampilkan file)...\\e[0m"
pkill -f "http-server" > /dev/null 2>&1 || true
npx http-server ~ -p ${LOCAL_PORT} --cors -c-1 -s &

cat << 'TUNNEL_EOF' > ~/.termux_tunnel/tunnel.js
const WebSocket = require('ws');
const http = require('http');

const WORKER_URL = '${url.origin}';
const WS_URL = WORKER_URL.replace('http', 'ws') + '/_ws';
const AUTH_TOKEN_VAL = '${AUTH_TOKEN}';
const LOCAL_PORT_VAL = ${LOCAL_PORT};

function connect() {
  console.log('[*] Menghubungkan ke ' + WS_URL);
  const ws = new WebSocket(WS_URL, {
    headers: { 'Authorization': 'Bearer ' + AUTH_TOKEN_VAL }
  });

  ws.on('open', () => {
    console.log('\\x1b[32m[+] Tunnel terhubung! Publik URL Anda:\\x1b[0m ' + WORKER_URL + '/termux');
    console.log('\\x1b[36m[*] Meneruskan traffic publik ke localhost:\\x1b[0m' + LOCAL_PORT_VAL);
  });

  ws.on('message', async (data) => {
    try {
      const reqData = JSON.parse(data.toString());
      
      const options = {
        hostname: '127.0.0.1',
        port: LOCAL_PORT_VAL,
        path: new URL(reqData.url).pathname + new URL(reqData.url).search,
        method: reqData.method,
        headers: reqData.headers
      };
      delete options.headers['host'];

      const proxyReq = http.request(options, (proxyRes) => {
        let chunks = [];
        proxyRes.on('data', chunk => chunks.push(chunk));
        proxyRes.on('end', () => {
          const bodyBuffer = Buffer.concat(chunks);
          
          const cleanHeaders = { ...proxyRes.headers };
          delete cleanHeaders['transfer-encoding'];
          delete cleanHeaders['connection'];
          delete cleanHeaders['keep-alive'];
          
          ws.send(JSON.stringify({
            id: reqData.id,
            status: proxyRes.statusCode,
            headers: cleanHeaders,
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
TUNNEL_EOF

if ! grep -q ".termux_tunnel/tunnel.js" ~/.bashrc; then
  echo "cd ~/.termux_tunnel && pkill -f 'node tunnel.js' > /dev/null 2>&1 || true && node tunnel.js &" >> ~/.bashrc
  echo -e "\\e[1;32m[+] Berhasil ditambahkan ke .bashrc\\e[0m"
fi

echo -e "\\e[1;32m[+] Instalasi Selesai! Menjalankan tunnel sekarang...\\e[0m"
pkill -f "node tunnel.js" > /dev/null 2>&1 || true
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
      const [client, server] = Object.values(webSocketPair);
      
      server.accept();
      tunnelWs = server;
      
      if (env.accounts_kv) {
        await env.accounts_kv.put('TERMUX_STATUS', JSON.stringify({
          status: 'online',
          ip: request.headers.get('cf-connecting-ip') || 'unknown',
          lastPing: Date.now()
        }));
      }

      server.addEventListener('message', event => {
        try {
          const resData = JSON.parse(event.data);
          if (pendingRequests.has(resData.id)) {
            pendingRequests.get(resData.id)(resData);
          }
        } catch(e) {}
      });

      server.addEventListener('close', async () => {
        tunnelWs = null;
        if (env.accounts_kv) {
          await env.accounts_kv.put('TERMUX_STATUS', JSON.stringify({
            status: 'offline',
            lastPing: Date.now()
          }));
        }
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    // --- 3. Routing Request Publik ke Localhost Termux ---
    if (url.pathname === '/_status') {
      let statusData = null;
      try {
        if (env.accounts_kv) statusData = await env.accounts_kv.get('TERMUX_STATUS', { type: 'json' });
      } catch(e) {}
      
      const lastSeen = statusData && statusData.lastPing ? new Date(statusData.lastPing).toLocaleString('id-ID') : '-';
      const isOnlineElsewhere = statusData && statusData.status === 'online';
      const isOnlineHere = tunnelWs !== null;
      
      const isOnline = isOnlineHere || isOnlineElsewhere;
      
      const html = `<!DOCTYPE html><html lang="id"><head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tunnel Status - Ontime</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #020617; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
    .card { background: #0f172a; border: 1px solid #1e293b; padding: 30px; border-radius: 12px; max-width: 450px; width: 90%; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
    h1 { margin-top: 0; font-size: 1.5rem; }
    .badge { display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 999px; font-weight: 600; font-size: 0.875rem; margin-bottom: 20px; }
    .offline { background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); }
    .warning { background: rgba(234, 179, 8, 0.1); color: #eab308; border: 1px solid rgba(234, 179, 8, 0.2); }
    .online { background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.2); }
    p { color: #94a3b8; font-size: 0.9rem; line-height: 1.6; }
    .footer { margin-top: 25px; padding-top: 20px; border-top: 1px solid #1e293b; font-size: 0.8rem; color: #64748b; }
    ul { color: #94a3b8; font-size: 0.9rem; padding-left: 20px; }
    li { margin-bottom: 8px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; }
    .dot-red { background: #ef4444; box-shadow: 0 0 8px #ef4444; }
    .dot-yellow { background: #eab308; box-shadow: 0 0 8px #eab308; }
    .dot-green { background: #10b981; box-shadow: 0 0 8px #10b981; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🚇 Status Web Tunnel</h1>
    
    ${isOnlineHere ? 
       `<div class="badge online"><div class="dot dot-green"></div> ONLINE & TERHUBUNG</div>
       <p>Tunnel Termux sedang aktif dan terhubung ke node Cloudflare ini.</p>
       <p>Anda dapat mengakses server localhost Termux Anda melalui path: <br><br> <b><a href="/termux" style="color:#38bdf8;text-decoration:none;">/termux</a></b></p>`
    : isOnlineElsewhere ? 
       `<div class="badge warning"><div class="dot dot-yellow"></div> ONLINE (NODE LAIN)</div>
       <p>Termux terhubung, tetapi ke server edge Cloudflare yang berbeda.</p>
       <p><b>Tips:</b> Karena Cloudflare memiliki banyak server di seluruh dunia, request Anda mungkin masuk ke server Singapura, sedangkan Termux terhubung ke server Jakarta.</p>
       <ul>
         <li>Coba refresh (F5) halaman ini beberapa kali.</li>
         <li>Gunakan VPN agar request Anda diarahkan ke server yang sama.</li>
       </ul>`
       :
       `<div class="badge offline"><div class="dot dot-red"></div> OFFLINE / TERPUTUS</div>
       <p>Tidak ada koneksi aktif dari Termux saat ini.</p>
       <p><b>Solusi:</b></p>
       <ul>
         <li>Buka Termux Anda.</li>
         <li>Jalankan perintah instalasi yang ada di Dashboard Web Anda.</li>
         <li>Pastikan aplikasi server localhost Anda (port ${LOCAL_PORT}) sedang berjalan.</li>
       </ul>`
    }
    <div class="footer">
      <div><b>KV Data Terakhir:</b></div>
      <div>Status: ${statusData?.status || 'Belum ada'}</div>
      <div>IP Termux: ${statusData?.ip || '-'}</div>
      <div>Waktu: ${lastSeen}</div>
      ${!isOnlineHere ? `<div style="margin-top: 10px;"><a href="/_status" style="color: #38bdf8; text-decoration: none;">🔄 Refresh Status</a></div>` : ''}
    </div>
  </div>
</body>
</html>`;
      return new Response(html, { status: isOnlineHere ? 200 : 502, headers: { "Content-Type": "text/html" } });
    }

    // Proxy request ke Termux HANYA untuk path /termux
    if (url.pathname.startsWith('/termux')) {
      if (!tunnelWs) {
        return new Response("Tunnel Termux offline. Buka dashboard web dan jalankan script di Termux terlebih dahulu.", { 
          status: 502,
          headers: { "Content-Type": "text/plain" }
        });
      }

      const reqId = crypto.randomUUID();
      let reqBodyBase64 = null;
      
      const targetUrl = new URL(request.url);
      targetUrl.pathname = targetUrl.pathname.replace(/^\/termux/, '') || '/';
      
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
        url: targetUrl.toString(),
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
    }

    // Jika bukan path API, dan tidak di-proxy ke Termux, layani aset React UI
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    
    // Jika tidak ada ASSETS (dideploy via worker murni), tampilkan pesan
    return new Response("Tunnel Worker berjalan. UI React tidak disertakan dalam build ini.", { status: 200 });
  }
};
