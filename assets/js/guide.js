import { $, loadConfig, initChrome, copyText, flashCopied } from './common.js';

loadConfig().then(initChrome);

$('#copyPrompt').addEventListener('click', async (e) => {
  flashCopied(e.currentTarget, await copyText($('#prompt').textContent));
});
