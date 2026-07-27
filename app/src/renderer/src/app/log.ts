import log from 'electron-log/renderer';

// electron-log disables renderer-to-main IPC in packaged apps by default. This
// application deliberately keeps it enabled so an uncaught renderer failure is
// retained in the local diagnostic log after distribution as well.
log.transports.ipc.level = 'silly';
log.errorHandler.startCatching();
