/**
 * Light or dark on Kithena Jobs: the same tokens as the app, flipped by the
 * `dark` class Reach's stylesheet reads, and the same cookie name, so the
 * server renders the right class and the first paint is already right.
 * Nothing chosen follows the system.
 */
export const THEME_KEY = 'kithena-theme';

/** Remembers a choice for a year; `Lax`, because it only shapes the page. */
export function themeCookie(dark: boolean): string {
  return `${THEME_KEY}=${dark ? 'dark' : 'light'}; path=/; max-age=31536000; samesite=lax`;
}

/** Runs before paint: the cookie's choice, else the system's. */
export const themeScript = `try{var m=document.cookie.match(/(?:^|; )${THEME_KEY}=(dark|light)/);var d=m?m[1]==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d)}catch(e){}`;
