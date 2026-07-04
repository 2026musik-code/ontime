import { useState, useEffect } from 'react';
import { Copy, CheckCircle2, Server, Smartphone, Globe, Shield, Link2, Save } from 'lucide-react';

export default function App() {
  const [localPort, setLocalPort] = useState('8080');
  const [authToken, setAuthToken] = useState(Math.random().toString(36).substring(2, 15));
  const [workerUrl, setWorkerUrl] = useState(() => {
    if (typeof window !== 'undefined' && window.location.hostname.includes('.workers.dev')) {
      return window.location.origin;
    }
    return '';
  });
  const [kvId, setKvId] = useState('fc7e78f9ecec4a4b95fbf4ab82e1e057');
  const [copiedWorker, setCopiedWorker] = useState(false);
  const [copiedTermux, setCopiedTermux] = useState(false);
  const [copiedToml, setCopiedToml] = useState(false);
  
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const displayUrl = workerUrl.trim() ? (workerUrl.startsWith('http') ? workerUrl : `https://${workerUrl}`) : 'https://YOUR_WORKER.workers.dev';
  const cleanUrl = displayUrl.replace(/\/$/, '');
  const installCmd = `curl -sL ${cleanUrl}/setup | bash`;

  const saveConfigToKV = async () => {
    if (!workerUrl.trim() || workerUrl.includes('YOUR_WORKER')) {
      setErrorMessage('Silakan masukkan URL Worker yang valid terlebih dahulu.');
      setSaveStatus('error');
      return;
    }
    
    setIsSaving(true);
    setSaveStatus('idle');
    setErrorMessage('');
    
    try {
      const response = await fetch(`${cleanUrl}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: localPort, token: authToken })
      });
      
      if (!response.ok) {
        let errDetails = 'Pastikan worker sudah di-deploy dan KV accounts_kv sudah di-bind.';
        try {
          const errData = await response.json();
          if (errData.error) {
            errDetails = errData.error;
          }
        } catch(e) {}
        throw new Error(`Gagal menyimpan: ${errDetails}`);
      }
      
      setSaveStatus('success');
    } catch (err: any) {
      setSaveStatus('error');
      setErrorMessage(err.message || 'Gagal menyimpan konfigurasi. Pastikan Worker sudah di-deploy dengan benar.');
    } finally {
      setIsSaving(false);
    }
  };

  const wranglerToml = `name = "termux-tunnel"
main = "src/index.js"
compatibility_date = "2024-03-20"

[[kv_namespaces]]
binding = "accounts_kv"
id = "${kvId || "YOUR_KV_NAMESPACE_ID"}"`;

  const workerCode = `let tunnelWs = null;
const pendingRequests = new Map();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // --- API Endpoint: Simpan Config dari Web UI ke KV ---
    if (url.pathname === '/api/config' && request.method === 'POST') {
      try {
        if (!env.accounts_kv) {
          throw new Error("KV 'accounts_kv' belum di-bind di Settings Cloudflare Anda.");
        }
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

    // Ambil Config dari KV accounts_kv (dengan fallback aman)
    let AUTH_TOKEN = "default_token";
    let LOCAL_PORT = "8080";
    if (env.accounts_kv) {
       AUTH_TOKEN = (await env.accounts_kv.get('AUTH_TOKEN')) || "default_token";
       LOCAL_PORT = (await env.accounts_kv.get('LOCAL_PORT')) || "8080";
    }

    // --- 1. Endpoint instalasi otomatis untuk Termux ---
    if (url.pathname === '/setup') {
      const script = \`#!/bin/bash
echo -e "\\\\e[1;34m[+]===============================================[+]\\\\e[0m"
echo -e "\\\\e[1;34m |      ONTIME TERMUX TUNNEL INSTALLER           |\\\\e[0m"
echo -e "\\\\e[1;34m[+]===============================================[+]\\\\e[0m"
echo -e "\\\\e[1;32m[+] Menyiapkan Tunnel Localhost ke Cloudflare Worker...\\\\e[0m"

echo -e "\\\\e[1;33m[*] Menginstall Node.js...\\\\e[0m"
pkg install nodejs -y > /dev/null 2>&1

mkdir -p ~/.termux_tunnel
cd ~/.termux_tunnel

if [ ! -f package.json ]; then
  npm init -y > /dev/null 2>&1
fi

echo -e "\\\\e[1;33m[*] Menginstall modul WebSocket & http-server...\\\\e[0m"
npm install ws http-server > /dev/null 2>&1

echo -e "\\\\e[1;33m[*] Memulai Web Server lokal di port \${LOCAL_PORT} (menampilkan file)...\\\\e[0m"
pkill -f "http-server" > /dev/null 2>&1 || true
npx http-server ~ -p \${LOCAL_PORT} --cors -c-1 -s &

cat << 'EOF' > ~/.termux_tunnel/tunnel.js
const WebSocket = require('ws');
const http = require('http');

const WORKER_URL = '\${url.origin}';
const WS_URL = WORKER_URL.replace('http', 'ws') + '/_ws';
const AUTH_TOKEN = '\${AUTH_TOKEN}';
const LOCAL_PORT = \${LOCAL_PORT};

function connect() {
  console.log('[*] Menghubungkan ke ' + WS_URL);
  const ws = new WebSocket(WS_URL, {
    headers: { 'Authorization': 'Bearer ' + AUTH_TOKEN }
  });

  ws.on('open', () => {
    console.log('\\\\x1b[32m[+] Tunnel terhubung! Publik URL Anda:\\\\x1b[0m ' + WORKER_URL);
    console.log('\\\\x1b[36m[*] Meneruskan traffic publik ke localhost:\\\\x1b[0m' + LOCAL_PORT);
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
          
          // Hapus header yang dapat menyebabkan error di browser / Cloudflare
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
EOF

if ! grep -q ".termux_tunnel/tunnel.js" ~/.bashrc; then
  echo "cd ~/.termux_tunnel && node tunnel.js &" >> ~/.bashrc
  echo -e "\\\\e[1;32m[+] Berhasil ditambahkan ke .bashrc\\\\e[0m"
fi

echo -e "\\\\e[1;32m[+] Instalasi Selesai! Menjalankan tunnel sekarang...\\\\e[0m"
pkill -f "node tunnel.js" > /dev/null 2>&1 || true
cd ~/.termux_tunnel && node tunnel.js
\`;
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
      if (request.headers.get("Authorization") !== \`Bearer \${AUTH_TOKEN}\`) {
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
      
      // Simpan status online ke KV
      ctx.waitUntil(env.accounts_kv.put('TERMUX_STATUS', JSON.stringify({
        status: 'online',
        ip: request.headers.get('cf-connecting-ip') || 'unknown',
        lastPing: Date.now()
      })));

      server.addEventListener('message', event => {
        try {
          const data = JSON.parse(event.data);
          if (data.id && pendingRequests.has(data.id)) {
            pendingRequests.get(data.id)(data);
          }
        } catch (e) {}
      });
      
      server.addEventListener('close', () => {
        if (tunnelWs === server) {
          tunnelWs = null;
          // Simpan status offline ke KV
          ctx.waitUntil(env.accounts_kv.put('TERMUX_STATUS', JSON.stringify({
            status: 'offline',
            lastPing: Date.now()
          })));
        }
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    // --- 3. Routing Request Publik ke Localhost Termux ---
    if (url.pathname === '/_status' || !tunnelWs) {
      let statusData = null;
      try {
        statusData = await env.accounts_kv.get('TERMUX_STATUS', { type: 'json' });
      } catch(e) {}
      
      const lastSeen = statusData && statusData.lastPing ? new Date(statusData.lastPing).toLocaleString('id-ID') : '-';
      const isOnlineElsewhere = statusData && statusData.status === 'online';
      const isOnlineHere = tunnelWs !== null;
      
      const isOnline = isOnlineHere || isOnlineElsewhere;

      const html = \`<!DOCTYPE html>
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
    
    \${isOnlineHere ? 
      \`<div class="badge online"><div class="dot dot-green"></div> ONLINE & TERHUBUNG</div>
       <p>Tunnel Termux sedang aktif dan terhubung ke node Cloudflare ini.</p>
       <p>Anda dapat mengakses server localhost Termux Anda melalui URL Worker ini (kecuali path <code>/_status</code>).</p>\`
    : isOnlineElsewhere ? 
      \`<div class="badge warning"><div class="dot dot-yellow"></div> ONLINE (NODE LAIN)</div>
       <p>Termux terhubung, tetapi ke server edge Cloudflare yang berbeda.</p>
       <p><b>Tips:</b> Karena Cloudflare memiliki banyak server di seluruh dunia, request Anda mungkin masuk ke server Singapura, sedangkan Termux terhubung ke server Jakarta.</p>
       <ul>
         <li>Coba refresh (F5) halaman ini beberapa kali.</li>
         <li>Gunakan VPN agar request Anda diarahkan ke server yang sama.</li>
       </ul>\` 
      : 
      \`<div class="badge offline"><div class="dot dot-red"></div> OFFLINE / TERPUTUS</div>
       <p>Tidak ada koneksi aktif dari Termux saat ini.</p>
       <p><b>Solusi:</b></p>
       <ul>
         <li>Buka Termux Anda.</li>
         <li>Jalankan perintah instalasi yang ada di Dashboard Web Anda.</li>
         <li>Pastikan aplikasi server localhost Anda (port \${LOCAL_PORT}) sedang berjalan.</li>
       </ul>\`
    }

    <div class="footer">
      <div><b>KV Data Terakhir:</b></div>
      <div>Status: \${statusData?.status || 'Belum ada'}</div>
      <div>IP Termux: \${statusData?.ip || '-'}</div>
      <div>Waktu: \${lastSeen}</div>
      \${!isOnlineHere ? \`<div style="margin-top: 10px;"><a href="/_status" style="color: #38bdf8; text-decoration: none;">🔄 Refresh Status</a></div>\` : ''}
    </div>
  </div>
</body>
</html>\`;
      return new Response(html, { status: isOnlineHere ? 200 : 502, headers: { "Content-Type": "text/html" } });
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
};`;

  const handleCopy = (text: string, setter: (val: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  };

  return (
    <div className="h-screen w-full bg-slate-950 text-slate-200 font-sans flex flex-col overflow-hidden select-none">
      {/* Header Section */}
      <header className="h-16 border-b border-slate-800 px-4 md:px-6 flex items-center justify-between bg-slate-900/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-emerald-500 rounded flex items-center justify-center shrink-0">
            <span className="text-slate-950 font-bold text-xs font-mono">ON</span>
          </div>
          <h1 className="text-base md:text-lg font-semibold tracking-tight text-white uppercase">
            Ontime.Tunnel <span className="text-slate-500 font-normal">v3.0.0</span>
          </h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse"></div>
            <span className="text-xs font-mono uppercase tracking-widest text-emerald-400 hidden sm:inline-block">Bridge Ready</span>
          </div>
          <div className="h-8 w-px bg-slate-800 hidden sm:block"></div>
          <div className="text-xs font-mono text-slate-400 hidden md:block">KV ID: {kvId.substring(0, 8)}...</div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col lg:flex-row p-4 md:p-6 gap-6 overflow-y-auto lg:overflow-hidden">
        {/* Left Column: Config */}
        <div className="lg:w-1/3 flex flex-col gap-6 lg:overflow-y-auto">
          {/* Instruksi KV */}
          <section className="bg-slate-900 border border-slate-800 rounded-lg p-5 flex flex-col gap-3">
            <h2 className="text-xs font-bold uppercase tracking-widest text-emerald-400 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              1. Setup KV (Wajib!)
            </h2>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Jika Anda mendeploy ini sebagai <b>Cloudflare Pages</b>, API Tunnel sudah terpasang otomatis! Anda <b>TIDAK PERLU</b> membuat Worker terpisah. Cukup lakukan Binding KV:
            </p>
            <p className="text-[11px] text-slate-400 leading-relaxed bg-slate-950 p-2 border border-slate-800 rounded">
              1. Buka <b>Cloudflare Pages</b> Anda &gt; <b>Settings</b>.<br/>
              2. Pilih <b>Bindings</b> &gt; <b>KV Namespace Bindings</b> &gt; Add.<br/>
              3. Variable name: <code className="text-emerald-400 font-bold">accounts_kv</code>.<br/>
              4. Pilih/buat KV namespace, lalu <b>Deploy</b> ulang.<br/>
              5. Masukkan URL web ini ke form di bawah, lalu klik Simpan.
            </p>
            <p className="text-[11px] text-slate-500 leading-relaxed mt-2 border-t border-slate-800 pt-2">
              Atau, jika mendeploy terpisah via Worker Wrangler:
            </p>
            <div className="bg-slate-950 p-2 rounded border border-slate-800 text-sky-400 font-mono text-[11px] select-all">
              npx wrangler kv:namespace create accounts_kv
            </div>
          </section>

          <section className="bg-slate-900 border border-slate-800 rounded-lg p-5 flex flex-col gap-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
              <Globe className="w-4 h-4" />
              2. Tunnel Configuration
            </h2>
            <div className="flex flex-col gap-4">
              <div className="pb-2 border-b border-slate-800">
                <label className="block text-[10px] text-slate-500 uppercase mb-1 font-mono">Worker URL Anda</label>
                <div className="flex items-center bg-slate-950 border border-slate-700 rounded overflow-hidden focus-within:border-emerald-500 transition-colors">
                  <span className="px-3 text-slate-500 font-mono border-r border-slate-700"><Link2 className="w-4 h-4" /></span>
                  <input
                    type="text"
                    value={workerUrl}
                    onChange={(e) => setWorkerUrl(e.target.value)}
                    className="w-full bg-transparent p-2 font-mono text-sm text-emerald-400 outline-none"
                    placeholder="https://ontime.ahem7553.workers.dev"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-[10px] text-slate-500 uppercase mb-1 font-mono">KV Namespace ID</label>
                <div className="flex items-center bg-slate-950 border border-slate-700 rounded overflow-hidden">
                  <span className="px-3 text-slate-500 font-mono text-sm border-r border-slate-700">ID</span>
                  <input
                    type="text"
                    value={kvId}
                    onChange={(e) => setKvId(e.target.value)}
                    className="w-full bg-transparent p-2 font-mono text-sm text-emerald-400 outline-none"
                    placeholder="fc7e78f9ecec4a4b95fbf4ab82e1e057"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-[10px] text-slate-500 uppercase mb-1 font-mono">Localhost Port (Termux)</label>
                <div className="flex items-center bg-slate-950 border border-slate-700 rounded overflow-hidden">
                  <span className="px-3 text-slate-500 font-mono text-sm border-r border-slate-700">PORT</span>
                  <input
                    type="number"
                    value={localPort}
                    onChange={(e) => setLocalPort(e.target.value)}
                    className="w-full bg-transparent p-2 font-mono text-sm text-emerald-400 outline-none"
                    placeholder="8080"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 uppercase mb-1 font-mono">Security Token</label>
                <div className="flex items-center bg-slate-950 border border-slate-700 rounded overflow-hidden">
                  <span className="px-3 text-slate-500 font-mono border-r border-slate-700"><Shield className="w-4 h-4" /></span>
                  <input
                    type="text"
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    className="w-full bg-transparent p-2 font-mono text-sm text-emerald-400 outline-none"
                    placeholder="Secret Token"
                  />
                </div>
              </div>

              <div className="flex gap-2 mt-2">
                <button
                  onClick={saveConfigToKV}
                  disabled={isSaving || !workerUrl}
                  className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold py-3 rounded text-sm transition-colors uppercase tracking-tighter shadow-lg shadow-emerald-900/20"
                >
                  {isSaving ? (
                    <span className="animate-pulse">Menyimpan ke KV...</span>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Simpan & Generate
                    </>
                  )}
                </button>
                <a 
                  href={`${cleanUrl}/_status`}
                  target="_blank"
                  className={`flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 px-4 rounded text-sm transition-colors uppercase tracking-tighter shadow-lg ${!workerUrl || workerUrl.includes('YOUR_WORKER') ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  <Globe className="w-4 h-4" />
                  Status
                </a>
              </div>
              
              {saveStatus === 'success' && (
                <p className="text-xs text-emerald-400 font-mono mt-1 text-center bg-emerald-900/20 p-2 rounded">
                  ✅ Config berhasil disimpan di accounts_kv!
                </p>
              )}
              {saveStatus === 'error' && (
                <p className="text-xs text-red-400 font-mono mt-1 text-center bg-red-900/20 p-2 rounded">
                  ❌ {errorMessage}
                </p>
              )}
            </div>
          </section>

          <section className="bg-slate-900 border border-slate-800 rounded-lg p-5 flex flex-col gap-3 shrink-0">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
              <Smartphone className="w-4 h-4" />
              3. Auto-Install di Termux
            </h2>
            <div className="bg-slate-950 rounded-md p-4 font-mono text-xs border border-emerald-500/30 leading-relaxed overflow-hidden relative group">
              <span className="text-emerald-500 block break-all pr-8">
                {installCmd}
              </span>
              <button
                onClick={() => handleCopy(installCmd, setCopiedTermux)}
                disabled={saveStatus !== 'success'}
                className="absolute right-2 top-2 w-7 h-7 flex items-center justify-center bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded transition-colors"
                title="Copy Termux Command"
              >
                {copiedTermux ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[10px] text-slate-500 italic">
              Setelah konfigurasi disimpan (tombol hijau), copy perintah di atas dan jalankan di Termux. URL dan Token sudah terhubung otomatis.
            </p>
          </section>
        </div>

        {/* Right Column: Terminal/Logs */}
        <div className="flex-1 flex flex-col bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-2xl min-h-[400px]">
          <div className="h-10 bg-slate-800/50 flex items-center justify-between px-4 border-b border-slate-800 shrink-0">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/50"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/50"></div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Server className="w-3.5 h-3.5" /> _worker.js & wrangler.toml
              </span>
              <button
                onClick={() => handleCopy(wranglerToml, setCopiedToml)}
                className="flex items-center gap-1.5 text-[10px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1 rounded transition-colors uppercase tracking-widest"
              >
                {copiedToml ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copiedToml ? 'Copied' : 'Copy TOML'}
              </button>
              <button
                onClick={() => handleCopy(workerCode, setCopiedWorker)}
                className="flex items-center gap-1.5 text-[10px] font-mono bg-slate-800 hover:bg-emerald-900/50 text-emerald-400 border border-emerald-500/30 px-3 py-1 rounded transition-colors uppercase tracking-widest"
              >
                {copiedWorker ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copiedWorker ? 'Copied' : 'Copy Worker Code'}
              </button>
            </div>
          </div>
          <div className="flex-1 p-4 font-mono text-[11px] md:text-xs leading-relaxed overflow-y-auto bg-slate-950 flex flex-col gap-4">
            <div>
              <p className="text-slate-400 mb-2 border-b border-slate-800 pb-1 uppercase tracking-widest">wrangler.toml</p>
              <pre className="text-emerald-300 whitespace-pre-wrap break-all bg-slate-900 p-3 rounded">
                <code>{wranglerToml}</code>
              </pre>
            </div>
            <div>
              <p className="text-slate-400 mb-2 border-b border-slate-800 pb-1 uppercase tracking-widest">src/index.js</p>
              <pre className="text-slate-300 whitespace-pre-wrap break-all">
                <code>{workerCode}</code>
              </pre>
            </div>
          </div>
          
          {/* Stats Row */}
          <div className="h-16 bg-slate-950 border-t border-slate-800 grid grid-cols-4 divide-x divide-slate-800 shrink-0">
            <div className="flex flex-col items-center justify-center">
              <span className="text-[9px] text-slate-500 uppercase">Architecture</span>
              <span className="text-xs md:text-sm font-bold text-white">Reverse Proxy</span>
            </div>
            <div className="flex flex-col items-center justify-center">
              <span className="text-[9px] text-slate-500 uppercase">Protocol</span>
              <span className="text-xs md:text-sm font-bold text-white">WSS / HTTP</span>
            </div>
            <div className="flex flex-col items-center justify-center">
              <span className="text-[9px] text-slate-500 uppercase">KV Namespace</span>
              <span className="text-xs md:text-sm font-bold text-white">accounts_kv</span>
            </div>
            <div className="flex flex-col items-center justify-center">
              <span className="text-[9px] text-slate-500 uppercase">Auto Start</span>
              <span className="text-xs md:text-sm font-bold text-emerald-400 uppercase">.bashrc</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="h-10 px-4 md:px-6 border-t border-slate-800 flex items-center justify-between text-[10px] font-mono text-slate-500 shrink-0">
        <div className="flex gap-4 uppercase hidden md:flex">
          <span>Env: Production</span>
          <span>Node: cf-edge-sea-09</span>
        </div>
        <div className="flex gap-4 items-center w-full justify-between md:w-auto">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span> KV Data Linked</span>
          <span className="text-slate-400">© 2024 ONTIME LABS</span>
        </div>
      </footer>
    </div>
  );
}
