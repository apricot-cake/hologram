import log from 'electron-log/renderer';

// electron-log は、パッケージ済みのアプリではレンダラーから main への IPC を既定で無効に
// する。このアプリケーションは意図してそれを有効のままにしている＝配布したあとも、
// レンダラーで捕まえ損ねた失敗がローカルの診断のログに残るようにするため。
log.transports.ipc.level = 'silly';
log.errorHandler.startCatching();
