// Chemin interne tenant compte de `base` (le site est servi sous /site).
export const u = (path = '') => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const p = path.replace(/^\//, '');
  return p ? `${base}/${p}` : `${base}/`;
};
