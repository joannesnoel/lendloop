import type { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      // Clerk Frontend API URL, e.g. https://your-app.clerk.accounts.dev
      // Set with: npx convex env set CLERK_JWT_ISSUER_DOMAIN <url>
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
