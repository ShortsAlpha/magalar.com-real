import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Everything behind login: the TTS studio and the audio download proxy.
const isProtectedRoute = createRouteMatcher(['/studio(.*)', '/api/download(.*)']);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params
    '/((?!_next|[^?]*\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp3|wav)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
