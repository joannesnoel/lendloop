import { clerkMiddleware } from "@clerk/nextjs/server";

// Makes the Clerk session available to server code. It does not decide who
// may see what: signed-out visitors are turned away in app/(app)/layout.tsx,
// and the data itself is protected inside every Convex function.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
