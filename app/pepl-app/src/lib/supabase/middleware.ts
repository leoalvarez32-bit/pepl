// =============================================================================
// Middleware helper — refreshes the Supabase session cookie on every request
// so Server Components can rely on auth.getUser() being current.
//
// Called from src/middleware.ts.
// =============================================================================
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: don't add code between the createServerClient call and getUser().
  // Doing so risks the session getting out of sync.
  const { data: { user } } = await supabase.auth.getUser();

  // Gate authed-only paths
  const path = request.nextUrl.pathname;
  const isAuthPath = path.startsWith('/login') || path.startsWith('/auth');
  const isPublicPath = path === '/';

  if (!user && !isAuthPath && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && (path === '/' || path === '/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return response;
}
