// An explicit snow switch overrides the theme effect without changing its colors.
export function selectedEffect(theme, settings = {}) {
  if (settings.reduceMotion || settings.themeFx === false) return 'none';
  if (settings.snowflakes === true) return 'snow';
  const effect = theme?.effect || 'none';
  return settings.snowflakes === false && effect === 'snow' ? 'none' : effect;
}
