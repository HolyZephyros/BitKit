const net = require('net');

let proxyServer = null;
let proxyPort = 0;
let globalRateLimitKBps = 0;

let globalTokens = 0;
let lastTick = Date.now();
const activeStreams = new Set();
let globalTimer = null;

function globalTick() {
  if (!globalRateLimitKBps || activeStreams.size === 0) {
    globalTokens = 0;
    lastTick = Date.now();
    return;
  }

  const now = Date.now();
  const dt = now - lastTick;
  lastTick = now;

  const maxTokens = globalRateLimitKBps * 1024;
  const bytesToAdd = (globalRateLimitKBps * 1024) * (dt / 1000);

  globalTokens = Math.min(globalTokens + bytesToAdd, maxTokens);

  const streamsWithData = Array.from(activeStreams).filter(s => s.queue.length > 0);
  if (streamsWithData.length === 0) return;

  const tokensPerStream = globalTokens / streamsWithData.length;

  for (const stream of streamsWithData) {
    stream.processQueue(tokensPerStream);
  }
}

class ThrottledStream {
  constructor(clientSocket, targetSocket) {
    this.clientSocket = clientSocket;
    this.targetSocket = targetSocket;
    this.queue = [];
    this.isPaused = false;
  }

  enqueue(chunk) {
    if (!globalRateLimitKBps) {
      this.clientSocket.write(chunk);
      return;
    }
    this.queue.push(chunk);

    let totalQueueSize = this.queue.reduce((acc, c) => acc + c.length, 0);
    if (totalQueueSize > 2 * 1024 * 1024 && !this.isPaused) {
      this.targetSocket.pause();
      this.isPaused = true;
    }
  }

  processQueue(maxTokensAllowed) {
    let tokensUsed = 0;

    while (this.queue.length > 0 && globalTokens >= 1 && tokensUsed < maxTokensAllowed) {
      const chunk = this.queue[0];
      const available = Math.floor(Math.min(globalTokens, maxTokensAllowed - tokensUsed));
      if (available <= 0) break;

      if (chunk.length <= available) {
        globalTokens -= chunk.length;
        tokensUsed += chunk.length;
        this.queue.shift();
        this.clientSocket.write(chunk);
      } else {
        const part1 = chunk.slice(0, available);
        this.queue[0] = chunk.slice(available);
        globalTokens -= available;
        tokensUsed += available;
        this.clientSocket.write(part1);
      }
    }

    if (this.isPaused) {
      let totalQueueSize = this.queue.reduce((acc, c) => acc + c.length, 0);
      if (totalQueueSize < 512 * 1024) {
        this.targetSocket.resume();
        this.isPaused = false;
      }
    }
  }

  flush() {
    while (this.queue.length > 0) {
      this.clientSocket.write(this.queue.shift());
    }
    if (this.isPaused) {
      this.targetSocket.resume();
      this.isPaused = false;
    }
  }

  destroy() {
    this.queue = [];
    if (this.isPaused) {
      this.targetSocket.resume();
      this.isPaused = false;
    }
  }
}

function startProxy(port = 0) {
  if (globalTimer) clearInterval(globalTimer);
  globalTimer = setInterval(globalTick, 20);
  lastTick = Date.now();

  return new Promise((resolve, reject) => {
    proxyServer = net.createServer((clientSocket) => {
      let isConnected = false;

      clientSocket.once('data', (data) => {
        try {
          const request = data.toString();
          const firstLine = request.split('\r\n')[0];

          if (!firstLine || !firstLine.startsWith('CONNECT ')) {
            clientSocket.write('HTTP/1.1 405 Method Not Allowed\r\n\r\n');
            clientSocket.destroy();
            return;
          }

          const targetUrl = firstLine.split(' ')[1];
          if (!targetUrl) {
            clientSocket.destroy();
            return;
          }

          const lastColon = targetUrl.lastIndexOf(':');
          const hostname = lastColon > 0 ? targetUrl.substring(0, lastColon) : targetUrl;
          const portStr = lastColon > 0 ? targetUrl.substring(lastColon + 1) : '';
          const targetPort = parseInt(portStr, 10) || 443;

          if (!hostname) {
            clientSocket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
            clientSocket.destroy();
            return;
          }

          if ((hostname === 'localhost' || hostname.startsWith('127.')) && targetPort === proxyPort) {
            clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            clientSocket.destroy();
            return;
          }

          require('dns').lookup(hostname, (err, address) => {
            if (err || !address) {
              clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
              clientSocket.destroy();
              return;
            }

            const targetSocket = net.connect(targetPort, address, () => {
              isConnected = true;
              clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-agent: BitKit-Internal-Proxy\r\n\r\n');

              const throttledStream = new ThrottledStream(clientSocket, targetSocket);
              activeStreams.add(throttledStream);

              targetSocket.on('data', (chunk) => {
                throttledStream.enqueue(chunk);
              });

              clientSocket.on('data', (chunk) => {
                if (isConnected && targetSocket.writable) {
                  targetSocket.write(chunk);
                }
              });

              let cleaned = false;
              const cleanup = () => {
                if (cleaned) return;
                cleaned = true;
                throttledStream.destroy();
                activeStreams.delete(throttledStream);
                clientSocket.destroy();
                targetSocket.destroy();
              };

              targetSocket.on('end', cleanup);
              targetSocket.on('error', cleanup);
              clientSocket.on('end', cleanup);
              clientSocket.on('error', cleanup);
            });

            targetSocket.on('error', (err) => {
              if (!isConnected) {
                try { clientSocket.end(`HTTP/1.1 500 Internal Server Error\r\n\r\n${err.message}`); } catch (e) {}
              }
            });
          });
        } catch (err) {
          try { clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (e) {}
        }
      });

      clientSocket.on('error', () => {
        clientSocket.destroy();
      });
    });

    proxyServer.on('error', reject);

    proxyServer.listen(port, '127.0.0.1', () => {
      proxyPort = proxyServer.address().port;
      console.log(`[BitKit:Proxy] Started internal proxy on 127.0.0.1:${proxyPort}`);
      resolve(proxyPort);
    });
  });
}

function stopProxy() {
  if (globalTimer) { clearInterval(globalTimer); globalTimer = null; }
  if (proxyServer) {
    proxyServer.close();
    proxyServer = null;
  }
}

function getProxyPort() {
  return proxyPort;
}

function setGlobalRate(rateKBps) {
  globalRateLimitKBps = rateKBps || 0;
  console.log(`[BitKit:Proxy] Global rate limit set to: ${globalRateLimitKBps ? globalRateLimitKBps + ' KB/s' : 'Unlimited'}`);
  globalTokens = 0;

  if (!globalRateLimitKBps) {
    for (const stream of activeStreams) {
      stream.flush();
    }
  }
}

module.exports = {
  startProxy,
  stopProxy,
  getProxyPort,
  setGlobalRate
};
