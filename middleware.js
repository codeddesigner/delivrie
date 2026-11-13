// Vercel Routing Middleware: pages switched off in Admin → Website return the 404 page.
// Settings are cached for 30 seconds per edge instance. If they can't be loaded, pages stay on (fail open).
export const config = {
  matcher: [
    '/pricing', '/about', '/customers', '/careers', '/brand', '/changelog', '/blog', '/blog/:path*', '/status',
    '/contact-sales', '/dpa', '/acceptable-use', '/cookies', '/subprocessors', '/security',
  ],
};

// These pages can't be switched off: app directories and the support links reviewers check rely on them.
const ALWAYS_ON = new Set(['/', '/terms', '/privacy', '/support']);
const SOURCE = 'https://hnjejflinvaoxbduxeiu.supabase.co/functions/v1/delivrie/public/site?only=pages';
let cache = { at: 0, pages: {} };

async function offPages() {
  if (Date.now() - cache.at < 30_000) return cache.pages;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 800);
    const r = await fetch(SOURCE, { signal: ctl.signal });
    clearTimeout(t);
    if (r.ok) cache = { at: Date.now(), pages: (await r.json()).pages || {} };
    else cache.at = Date.now();
  } catch { cache.at = Date.now() - 20_000; } // retry in 10 seconds
  return cache.pages;
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (!ALWAYS_ON.has(path)) {
    const pages = await offPages();
    const section = '/' + path.split('/')[1];
    if (pages[path] === false || pages[section] === false) {
      const nf = await fetch(new URL('/404.html', url));
      return new Response(nf.body, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }
  }
  return new Response(null, { headers: { 'x-middleware-next': '1' } });
}
