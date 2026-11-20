"use client";

import { useAuth } from "@clerk/nextjs";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { AuthLayout } from "../layouts/auth-layout";
import { SignInView } from "../views/sign-in-view";

export const AuthGuard = ({ children }: { children: React.ReactNode }) => {
  const { isLoaded, isSignedIn } = useAuth();

  // Clerk owns the browser session. Convex may briefly be unauthenticated
  // while its Clerk token is loading; never show SignIn to an active session.
  if (!isLoaded) {
    return (
      <AuthLayout>
        <p role="status" className="text-sm text-muted-foreground">Checking your session…</p>
      </AuthLayout>
    );
  }

  if (!isSignedIn) {
    return (
      <AuthLayout>
        <SignInView />
      </AuthLayout>
    );
  }

  return (
    <>
      <AuthLoading>
        <AuthLayout>
          <p role="status" className="text-sm text-muted-foreground">Connecting your workspace…</p>
        </AuthLayout>
      </AuthLoading>
      <Authenticated>{children}</Authenticated>
      <Unauthenticated>
        <AuthLayout>
          <div className="w-full max-w-md space-y-2 text-center">
            <h1 className="text-lg font-semibold">Workspace connection failed</h1>
            <p className="text-sm text-muted-foreground">
              You are signed in, but AgentBridge could not authenticate with its backend.
              Refresh the page or contact your workspace administrator. You will not be
              redirected through sign-in again.
            </p>
          </div>
        </AuthLayout>
      </Unauthenticated>
    </>
  );
};
