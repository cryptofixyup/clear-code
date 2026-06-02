import { NextRequest, NextResponse } from 'next/server';

// IMPORTANT: Do NOT implement auth/authz in middleware.
//
// CVE-2025-29927 (fixed in Next.js ≥15.2.3): the x-middleware-subrequest
// header could be forged to bypass middleware entirely, collapsing perimeter
// security. Even post-patch, the attack surface remains because middleware
// runs at the edge and cannot inspect secrets securely.
//
// Correct Zero-Trust pattern:
//   - Routing, geo-redirect, rate-limit hints, response headers → middleware (here)
//   - Auth, authz, row-level security                           → Server Components
//   - Sensitive modules                                         → import 'server-only'

export function middleware(request: NextRequest): NextResponse {
  const response = NextResponse.next();

  // Immutable security headers — safe in middleware because they are additive
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  );

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
