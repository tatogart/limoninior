export class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function request(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new ApiError(0, 'network');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(res.status, data?.error || 'error');
  return data;
}

export const api = {
  get: (url) => request('GET', `/api${url}`),
  post: (url, body = {}) => request('POST', `/api${url}`, body),
  patch: (url, body = {}) => request('PATCH', `/api${url}`, body),
  del: (url) => request('DELETE', `/api${url}`),
};

export const ERRORS = {
  network: 'Нет соединения с сервером',
  bad_username: 'Юзернейм: 5–32 символа, латиница, цифры и _, начинается с буквы',
  username_taken: 'Этот юзернейм уже занят',
  bad_name: 'Укажите имя',
  file_too_large: 'Файл слишком большой (максимум 10 МБ)',
  unsupported_image: 'Поддерживаются только JPG, PNG, WebP и GIF',
  too_long: 'Сообщение слишком длинное',
  banned: 'Аккаунт заблокирован',
  bad_credential: 'Не удалось войти через Google',
  forbidden: 'Недостаточно прав',
  not_found: 'Не найдено',
  bad_title: 'Укажите название',
  too_many_attempts: 'Слишком много попыток, подождите',
  bad_code: 'Неверный код',
  bad_login: 'Неверный юзернейм или пароль',
  weak_password: 'Пароль должен быть не короче 8 символов',
  bad_password: 'Слишком длинный пароль',
  bad_current_password: 'Текущий пароль неверный',
  not_enough_coins: 'Не хватает лимонов 🍋',
  bonus_not_ready: 'Бонус уже получен, приходите завтра',
  bad_sticker: 'Неизвестный стикер',
  bad_gift: 'Неизвестный подарок',
  bad_amount: 'Неверное количество',
  empty: 'Пустое сообщение',
  owner_cannot_leave: 'Владелец не может отписаться — канал можно только удалить',
  already_verified: 'Канал уже верифицирован',
  invite_invalid: 'Ссылка-приглашение недействительна',
  ip_banned: 'Доступ с вашего IP-адреса заблокирован',
  bad_ip: 'Некорректный IP-адрес',
  own_ip: 'Это ваш собственный IP — его банить нельзя',
  blocked: 'Пользователь ограничил вам отправку сообщений',
  you_blocked: 'Вы заблокировали этого пользователя',
  too_many_pins: 'Можно закрепить не больше 5 чатов',
  unsupported_audio: 'Формат записи не поддерживается',
  too_far: 'Сообщение слишком далеко в истории',
  bad_reaction: 'Такая реакция недоступна',
};

export const errorText = (e) => ERRORS[e?.code] || (e?.status === 429 ? 'Слишком часто, подождите немного' : 'Что-то пошло не так');
