import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { chromium } from 'playwright';
import { BrowserSession } from './session.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

// 탭을 닫거나 연결이 끊긴 뒤에도 브라우징 상태를 유지하는 시간(재접속 대비)
const SESSION_GRACE_MS = 60_000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// 기본은 Playwright가 설치한 Chromium.
// 로컬 테스트 시 BROWSER_CHANNEL=msedge(또는 chrome)로 설치된 브라우저를 쓸 수 있다.
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
browser.on('disconnected', () => {
  console.error('Chromium 프로세스가 종료되었습니다.');
  process.exit(1);
});

/** @type {Map<string, BrowserSession>} */
const sessions = new Map();

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }

  const file = normalize(join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  let session = null;

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;

    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (session) {
      session.handle(msg);
      return;
    }

    // 첫 메시지는 반드시 init
    if (msg.type !== 'init') return;
    session = claimSession(msg.sessionId);
    session.attach(ws, msg).catch((err) => {
      console.error('세션 시작 실패:', err);
      ws.close(1011, 'session start failed');
    });
  });

  ws.on('close', () => {
    if (!session || !session.detach(ws)) return;

    const closed = session;
    closed.expireTimer = setTimeout(() => {
      sessions.delete(closed.id);
      closed.dispose();
    }, SESSION_GRACE_MS);
  });
});

// 끊긴 세션이면 이어서 쓰고, 다른 탭이 이미 쓰고 있거나(탭 복제 등) 없으면 새로 만든다
function claimSession(id) {
  const existing = typeof id === 'string' ? sessions.get(id) : undefined;
  if (existing && !existing.connected) {
    clearTimeout(existing.expireTimer);
    return existing;
  }

  const session = new BrowserSession(browser, randomUUID());
  sessions.set(session.id, session);
  return session;
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`포트 ${PORT}은(는) 이미 사용 중입니다. 서버가 이미 실행 중일 수 있습니다.`);
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`GoogleBrowser Web 실행 중: http://localhost:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await browser.close().catch(() => {});
    process.exit(0);
  });
}
