const form = document.querySelector('#proposal-form');
const copyStatus = document.querySelector('#copy-status');
const fallback = document.querySelector('#copy-fallback');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const text = `Привет! Хочу предложить сотрудничество с Limochat.\n\nПроект: ${String(data.get('project')).trim()}\nСсылка: ${String(data.get('link')).trim() || 'пока нет'}\nКонтакт: ${String(data.get('contact')).trim()}\n\nИдея:\n${String(data.get('idea')).trim()}`;
  try {
    await navigator.clipboard.writeText(text);
    fallback.hidden = true;
    copyStatus.textContent = 'Предложение скопировано. Нажмите «Написать команде» и отправьте его в чате.';
  } catch {
    fallback.value = text; fallback.hidden = false; fallback.focus(); fallback.select();
    copyStatus.textContent = 'Скопируйте выделенный текст вручную и отправьте команде.';
  }
});
const retry = document.querySelector('#contact-retry');
async function loadContact() {
  const status = document.querySelector('#contact-status');
  retry.hidden = true;
  try {
    const response = await fetch('/api/partners/contact', { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!response.ok) throw new Error('contact unavailable');
    const { username } = await response.json();
    if (typeof username !== 'string' || !/^[a-z0-9_]{3,32}$/i.test(username)) throw new Error('contact missing');
    const link = document.querySelector('#contact');
    link.href = `/@${encodeURIComponent(username)}`; link.hidden = false;
    status.textContent = `Команда: @${username}. Для переписки войдите в Limochat.`;
  } catch {
    status.textContent = 'Не удалось загрузить контакт команды. Попробуйте ещё раз.'; retry.hidden = false;
  }
}
retry.addEventListener('click', loadContact);
loadContact();
