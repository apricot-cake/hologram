'use strict';

// 拡張機能の dev サーバーは上がっているか? それを起動する側（dev-extension.cts）
// と、すでに動いていることに依存する側（open-dev-profile.cts）の両方が共有
// する。これでポートは1箇所に住み、「すでに動いているか」はどこでも同じ
// やり方で答えられる。

const net = require('node:net');

// docs/開発ガイド.md。交渉ではなく固定にしてある: 2つ目のサーバーは別のポートへ
// こっそり逃げるのではなく bind に失敗する — これにより、どこか別の場所から
// 静かに古いビルドを配信するのではなく、二重起動そのものが自ら名乗り出る。
const DEV_SERVER_PORT = 51731;

// HTTP リクエストではなく TCP の接続: WXT の dev サーバーが拡張機能の
// リクエストに答え、ここで知る必要があるのはそのポートを何かが所有している
// かどうかだけ。
//
// `127.0.0.1` ではなく `localhost`。WXT は Vite が渡すものを bind し、それは
// ::1 で listen する — だから IPv4 限定のプローブは、動いているサーバーを
// 「落ちている」と報告してしまう。これは仮定の話ではない: このチェックは、
// それが向けられたどのサーバーに対しても「落ちている」と言い続けていた
// （同じ間違ったプローブがスターターにもコピーされた後、2026-08-04 に発覚）。
// `localhost` は両方に解決され、Node はそれを順に試す（autoSelectFamily）。
// これは拡張機能自身の fetch がやっていることとまったく同じ — それらは
// http://localhost:51731 を求めるので、これで実際に使われるアドレスを
// テストすることになる。
function devServerAlive(port: number = DEV_SERVER_PORT): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: 'localhost' });
    const finish = (alive: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

module.exports = { DEV_SERVER_PORT, devServerAlive };
