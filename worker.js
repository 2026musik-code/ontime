export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization"
        }
      });
    }

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

    // --- API Endpoint: Update Tunnel URL dari Termux ---
    if (url.pathname === '/api/update_tunnel' && request.method === 'POST') {
      try {
        if (!env.accounts_kv) throw new Error("KV missing");
        const body = await request.json();
        
        const auth = request.headers.get('Authorization');
        const token = await env.accounts_kv.get('AUTH_TOKEN');
        if (!auth || auth !== 'Bearer ' + token) {
           return new Response("Unauthorized", { status: 401 });
        }

        if (body.url) {
           await env.accounts_kv.put('TERMUX_TUNNEL_URL', body.url);
           await env.accounts_kv.put('TERMUX_STATUS', JSON.stringify({
             status: 'online',
             ip: request.headers.get('cf-connecting-ip') || 'unknown',
             lastPing: Date.now()
           }));
           return new Response(JSON.stringify({ success: true }));
        }
        return new Response("Bad Request", { status: 400 });
      } catch(e) {
        return new Response(e.message, { status: 500 });
      }
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
echo -e "\\e[1;33m[*] Menginstall modul localtunnel & http-server...\\e[0m"
npm install localtunnel http-server > /dev/null 2>&1

echo -e "\\e[1;33m[*] Memulai Web Server lokal di port ${LOCAL_PORT} (menampilkan file)...\\e[0m"
pkill -f "http-server" > /dev/null 2>&1 || true
npx http-server ~ -p ${LOCAL_PORT} --cors -c-1 -s &

cat << 'TUNNEL_EOF' > ~/.termux_tunnel/tunnel.js
const localtunnel = require('localtunnel');

const WORKER_URL = '${url.origin}';
const AUTH_TOKEN_VAL = '${AUTH_TOKEN}';
const LOCAL_PORT_VAL = ${LOCAL_PORT};

async function connect() {
  console.log('[*] Memulai localtunnel di port ' + LOCAL_PORT_VAL + '...');
  try {
    const tunnel = await localtunnel({ port: LOCAL_PORT_VAL });
    console.log('\\x1b[32m[+] Tunnel terhubung! Akses via web UI Anda: ' + WORKER_URL + '/termux\\x1b[0m');
    console.log('\\x1b[36m[-] (Atau langsung ke: ' + tunnel.url + ')\\x1b[0m');
    
    // Kirim URL tunnel ke Worker
    try {
      const response = await fetch(WORKER_URL + '/api/update_tunnel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + AUTH_TOKEN_VAL
        },
        body: JSON.stringify({ url: tunnel.url })
      });
      if (response.ok) {
         console.log('[-] Berhasil sinkronisasi dengan Cloudflare');
      } else {
         console.log('[-] Gagal sinkronisasi: ' + response.status);
      }
    } catch(e) {
      console.log('[-] Gagal koneksi ke Cloudflare:', e.message);
    }

    tunnel.on('close', () => {
      console.log('[-] Tunnel terputus. Menyambung kembali dalam 5 detik...');
      setTimeout(connect, 5000);
    });
  } catch (err) {
    console.log('[-] Error:', err.message);
    setTimeout(connect, 5000);
  }
}
connect();
TUNNEL_EOF

echo -e "\\e[1;32m[+] Instalasi selesai. Menjalankan tunnel...\\e[0m"
node ~/.termux_tunnel/tunnel.js
`;
      return new Response(script, {
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }

    // --- 2. Routing Request Publik ke Localhost Termux ---
    if (url.pathname === '/_status') {
      let statusData = null;
      let tunnelUrl = null;
      try {
        if (env.accounts_kv) {
           statusData = await env.accounts_kv.get('TERMUX_STATUS', { type: 'json' });
           tunnelUrl = await env.accounts_kv.get('TERMUX_TUNNEL_URL');
        }
      } catch(e) {}
      
      const lastSeen = statusData && statusData.lastPing ? new Date(statusData.lastPing).toLocaleString('id-ID') : '-';
      // Assume offline if older than 5 minutes
      const isOnline = statusData && statusData.status === 'online' && (Date.now() - statusData.lastPing < 5 * 60 * 1000);
      
      const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tunnel Status - Ontime</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #020617; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
    .card { background: #0f172a; border: 1px solid #1e293b; padding: 30px; border-radius: 12px; max-width: 450px; width: 90%; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
    h1 { margin-top: 0; font-size: 1.5rem; }
    .badge { display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 999px; font-weight: 600; font-size: 0.875rem; margin-bottom: 20px; }
    .offline { background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); }
    .online { background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.2); }
    p { color: #94a3b8; font-size: 0.9rem; line-height: 1.6; }
    .footer { margin-top: 25px; padding-top: 20px; border-top: 1px solid #1e293b; font-size: 0.8rem; color: #64748b; }
    ul { color: #94a3b8; font-size: 0.9rem; padding-left: 20px; }
    li { margin-bottom: 8px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; }
    .dot-red { background: #ef4444; box-shadow: 0 0 8px #ef4444; }
    .dot-green { background: #10b981; box-shadow: 0 0 8px #10b981; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🚇 Status Web Tunnel</h1>
    
    ${isOnline ? 
       `<div class="badge online"><div class="dot dot-green"></div> ONLINE</div>
       <p>Tunnel Termux sedang aktif.</p>
       <p>Anda dapat mengakses server localhost Termux Anda melalui path: <br><br> <b><a href="/termux" style="color:#38bdf8;text-decoration:none;">/termux</a></b></p>`
       :
       `<div class="badge offline"><div class="dot dot-red"></div> OFFLINE / TERPUTUS</div>
       <p>Tidak ada koneksi aktif dari Termux saat ini (atau terputus).</p>
       <p><b>Solusi:</b></p>
       <ul>
         <li>Buka Termux Anda dan batalkan proses tunnel lama (Ctrl+C).</li>
         <li>Jalankan perintah instalasi (curl) yang ada di Dashboard Web Anda.</li>
         <li>Pastikan aplikasi server localhost Anda (port ${LOCAL_PORT}) sedang berjalan.</li>
       </ul>`
    }

    <div class="footer">
      <div><b>KV Data Terakhir:</b></div>
      <div>IP Termux: ${statusData?.ip || '-'}</div>
      <div>Terakhir Sinkron: ${lastSeen}</div>
      ${!isOnline ? `<div style="margin-top: 10px;"><a href="/_status" style="color: #38bdf8; text-decoration: none;">🔄 Refresh Status</a></div>` : ''}
    </div>
  </div>
</body>
</html>`;
      return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
    }

    // Proxy request ke Termux via Localtunnel URL
    if (url.pathname.startsWith('/termux')) {
      let tunnelUrl = null;
      let statusData = null;
      try {
        if (env.accounts_kv) {
           tunnelUrl = await env.accounts_kv.get('TERMUX_TUNNEL_URL');
           statusData = await env.accounts_kv.get('TERMUX_STATUS', { type: 'json' });
        }
      } catch(e) {}
      
      const isOnline = statusData && statusData.status === 'online' && (Date.now() - statusData.lastPing < 5 * 60 * 1000);

      if (tunnelUrl && isOnline) {
        const targetPath = url.pathname.replace(/^\/termux/, '') || '/';
        const targetUrl = tunnelUrl + targetPath + url.search;
        return Response.redirect(targetUrl, 302);
      } else {
        const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Tunnel Offline</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #020617; color: #f8fafc; display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 100vh; margin: 0; text-align: center; padding: 20px;}
    .card { background: #0f172a; border: 1px solid #1e293b; padding: 30px; border-radius: 12px; max-width: 500px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
    h1 { color: #ef4444; margin-top: 0; font-size: 1.5rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Tunnel Offline</h1>
    <p>Tidak ada koneksi aktif dari Termux. Silakan buka dashboard web, copy script instalasi, dan jalankan ulang di Termux.</p>
    <button onclick="location.reload()" style="padding:10px 20px; background:#38bdf8; color:#020617; border:none; border-radius:5px; font-weight:bold; cursor:pointer; margin-top:20px;">Coba Lagi</button>
  </div>
</body>
</html>`;
        return new Response(html, { 
          status: 502,
          headers: { "Content-Type": "text/html" }
        });
      }
    }

    // Jika bukan path API, dan tidak di-proxy ke Termux, layani aset React UI
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    
    // Jika tidak ada ASSETS (dideploy via worker murni), tampilkan pesan
    return new Response("Tunnel Worker berjalan. UI React tidak disertakan dalam build ini.", { status: 200 });
  }
};
