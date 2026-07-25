//#region \0rolldown/runtime.js
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
//#endregion
let electron = require("electron");
//#region node_modules/electron-log/src/renderer/electron-log-preload.js
var require_electron_log_preload = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var electron = {};
	try {
		electron = require("electron");
	} catch (e) {}
	if (electron.ipcRenderer) initialize(electron);
	if (typeof module === "object") module.exports = initialize;
	/**
	* @param {Electron.ContextBridge} contextBridge
	* @param {Electron.IpcRenderer} ipcRenderer
	*/
	function initialize({ contextBridge, ipcRenderer }) {
		if (!ipcRenderer) return;
		ipcRenderer.on("__ELECTRON_LOG_IPC__", (_, message) => {
			window.postMessage({
				cmd: "message",
				...message
			});
		});
		ipcRenderer.invoke("__ELECTRON_LOG__", { cmd: "getOptions" }).catch((e) => console.error(/* @__PURE__ */ new Error(`electron-log isn't initialized in the main process. Please call log.initialize() before. ${e.message}`)));
		const electronLog = {
			sendToMain(message) {
				try {
					ipcRenderer.send("__ELECTRON_LOG__", message);
				} catch (e) {
					console.error("electronLog.sendToMain ", e, "data:", message);
					ipcRenderer.send("__ELECTRON_LOG__", {
						cmd: "errorHandler",
						error: {
							message: e?.message,
							stack: e?.stack
						},
						errorName: "sendToMain"
					});
				}
			},
			log(...data) {
				electronLog.sendToMain({
					data,
					level: "info"
				});
			}
		};
		for (const level of [
			"error",
			"warn",
			"info",
			"verbose",
			"debug",
			"silly"
		]) electronLog[level] = (...data) => electronLog.sendToMain({
			data,
			level
		});
		if (contextBridge && process.contextIsolated) try {
			contextBridge.exposeInMainWorld("__electronLog", electronLog);
		} catch {}
		if (typeof window === "object") window.__electronLog = electronLog;
		else __electronLog = electronLog;
	}
}));
(/* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = require_electron_log_preload();
})))();
electron.contextBridge.exposeInMainWorld("hologram", {
	getConfig: () => electron.ipcRenderer.invoke("get-config"),
	setExtensionId: (id) => electron.ipcRenderer.invoke("set-extension-id", id),
	listPosts: () => electron.ipcRenderer.invoke("list-posts"),
	listPostsDelta: (haveBaseline, changedNames) => electron.ipcRenderer.invoke("list-posts-delta", haveBaseline, changedNames),
	getTagTypes: () => electron.ipcRenderer.invoke("get-tag-types"),
	setTagTypes: (types, labels) => electron.ipcRenderer.invoke("set-tag-types", types, labels),
	getUngrouped: () => electron.ipcRenderer.invoke("get-ungrouped"),
	setUngrouped: (keys) => electron.ipcRenderer.invoke("set-ungrouped", keys),
	getPosterFolders: () => electron.ipcRenderer.invoke("get-poster-folders"),
	setPosterFolders: (data) => electron.ipcRenderer.invoke("set-poster-folders", data),
	getPosterTags: () => electron.ipcRenderer.invoke("get-poster-tags"),
	setPosterTags: (data) => electron.ipcRenderer.invoke("set-poster-tags", data),
	getManualGroups: () => electron.ipcRenderer.invoke("get-manual-groups"),
	setManualGroups: (groups) => electron.ipcRenderer.invoke("set-manual-groups", groups),
	getFolders: () => electron.ipcRenderer.invoke("get-folders"),
	setFolders: (data) => electron.ipcRenderer.invoke("set-folders", data),
	getTabs: () => electron.ipcRenderer.invoke("get-tabs"),
	setTabs: (data) => electron.ipcRenderer.invoke("set-tabs", data),
	openExternal: (url) => electron.ipcRenderer.invoke("open-external", url),
	openImageWindow: (image) => electron.ipcRenderer.invoke("open-image-window", image),
	showInFolder: (file) => electron.ipcRenderer.invoke("show-in-folder", file),
	dragOut: (files) => electron.ipcRenderer.send("drag-out", files),
	copyImage: (file) => electron.ipcRenderer.invoke("copy-image", file),
	getAppInfo: () => electron.ipcRenderer.invoke("app-info"),
	getPrefs: () => electron.ipcRenderer.invoke("get-prefs"),
	setPref: (key, value) => electron.ipcRenderer.invoke("set-pref", key, value),
	imageDataUrl: (image) => electron.ipcRenderer.invoke("image-data-url", image),
	deletePost: (image) => electron.ipcRenderer.invoke("delete-post", image),
	updateTags: (image, tags, patch) => electron.ipcRenderer.invoke("update-tags", image, tags, patch),
	importPosts: (posts) => electron.ipcRenderer.invoke("import-posts", posts),
	clearAll: () => electron.ipcRenderer.invoke("clear-all"),
	exportSave: (filename, bytes) => electron.ipcRenderer.invoke("export-save", filename, bytes),
	exportComplete: (mode) => electron.ipcRenderer.invoke("export-complete", mode),
	importComplete: (bytes) => electron.ipcRenderer.invoke("import-complete", bytes),
	pickSaveFolder: () => electron.ipcRenderer.invoke("pick-save-folder"),
	moveSaveFolder: (dest) => electron.ipcRenderer.invoke("move-save-folder", dest),
	onSaveFolderProgress: (cb) => {
		electron.ipcRenderer.on("save-folder-progress", (_e, p) => cb(p));
	},
	onExportProgress: (cb) => {
		const h = (_e, p) => cb(p);
		electron.ipcRenderer.on("export-progress", h);
		return () => electron.ipcRenderer.removeListener("export-progress", h);
	},
	getBackup: () => electron.ipcRenderer.invoke("get-backup"),
	setBackup: (patch) => electron.ipcRenderer.invoke("set-backup", patch),
	pickBackupDir: () => electron.ipcRenderer.invoke("pick-backup-dir"),
	runBackup: () => electron.ipcRenderer.invoke("run-backup"),
	importImages: () => electron.ipcRenderer.invoke("import-images"),
	onBackupStart: (cb) => {
		electron.ipcRenderer.on("backup-start", cb);
	},
	onBackupDone: (cb) => {
		electron.ipcRenderer.on("backup-done", cb);
	},
	listTrash: () => electron.ipcRenderer.invoke("list-trash"),
	restorePost: (image) => electron.ipcRenderer.invoke("restore-post", image),
	emptyTrash: () => electron.ipcRenderer.invoke("empty-trash"),
	deleteFromTrash: (image) => electron.ipcRenderer.invoke("delete-from-trash", image),
	onPostsChanged: (cb) => {
		electron.ipcRenderer.on("posts-changed", (_e, names) => cb(names));
	},
	windowControl: (action) => electron.ipcRenderer.invoke("window-control", action),
	windowIsMaximized: () => electron.ipcRenderer.invoke("window-is-maximized"),
	onWindowMaximizedChanged: (cb) => {
		electron.ipcRenderer.on("window-maximized-changed", (_e, maximized) => cb(maximized));
	}
});
//#endregion
