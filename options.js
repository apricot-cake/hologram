const DEFAULT_OPTIONS = {
  saveSidecarJson: false
};

let clearStatusTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
  const checkbox = document.getElementById('saveSidecarJson');
  const status = document.getElementById('status');
  const options = await chrome.storage.sync.get(DEFAULT_OPTIONS);

  checkbox.checked = Boolean(options.saveSidecarJson);

  checkbox.addEventListener('change', async () => {
    await chrome.storage.sync.set({
      saveSidecarJson: checkbox.checked
    });

    status.textContent = checkbox.checked
      ? 'JSON の保存をオンにしました。'
      : 'JSON の保存をオフにしました。';

    if (clearStatusTimer) {
      clearTimeout(clearStatusTimer);
    }

    clearStatusTimer = setTimeout(() => {
      status.textContent = '';
      clearStatusTimer = null;
    }, 1800);
  });
});
