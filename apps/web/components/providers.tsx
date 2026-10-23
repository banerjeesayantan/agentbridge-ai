"use client";

import * as React from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth } from "@clerk/nextjs";

if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
  throw new Error("Missing NEXT_PUBLIC_CONVEX_URL in your .env file");
}

const convex = new ConvexReactClient(
  process.env.NEXT_PUBLIC_CONVEX_URL
);

export function Providers({
  children,
}: {
  children: React.ReactNode;
}) {
  const { getToken, isLoaded, isSignedIn, orgId } = useAuth();

  React.useEffect(() => {
    if (!isLoaded) return;

    console.log("Clerk status:", {
      isSignedIn,
      orgId,
    });

    getToken({ template: "convex" })
      .then((token) => {
        if (!token) {
          console.error("Convex JWT token is missing");
          return;
        }

        const parts = token.split(".");
const encodedPayload = parts[1];

if (!encodedPayload) {
  console.error("Invalid JWT format");
  return;
}

const base64 = encodedPayload
  .replace(/-/g, "+")
  .replace(/_/g, "/");

const payload = JSON.parse(atob(base64));

console.log("Convex JWT claims:", {
  aud: payload.aud,
  orgId: payload.orgId,
  iss: payload.iss,
});

        console.log("Convex JWT claims:", {
          aud: payload.aud,
          orgId: payload.orgId,
          iss: payload.iss,
        });
      })
      .catch((error) => {
        console.error("Failed to get Convex JWT:", error);
      });
  }, [isLoaded, isSignedIn, orgId, getToken]);

  return (
    <ConvexProviderWithClerk
      client={convex}
      useAuth={useAuth}
    >
      {children}
    </ConvexProviderWithClerk>
  );
}