const localtunnel = require('localtunnel');
(async () => {
  const tunnel = await localtunnel({ port: 8080 });
  console.log("URL:", tunnel.url);
  tunnel.close();
})();
