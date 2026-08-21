/** The check a guard is handed. Server-only, like everything it reads. */

export const SIGNING_KEY = 'sk_live_never_ships_to_a_browser';

export function session(request: Request): { id: string } | null {
  const cookie = request.headers.get('cookie') ?? '';
  return cookie.includes(SIGNING_KEY) ? { id: 'u1' } : null;
}
