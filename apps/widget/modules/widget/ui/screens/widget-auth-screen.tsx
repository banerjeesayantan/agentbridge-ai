
"use client";

import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "convex/react";
import { useAtomValue, useSetAtom } from "jotai";
import { MessageCircle } from "lucide-react";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@workspace/ui/components/form";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";

import { api } from "@workspace/backend/_generated/api";
import { Doc } from "@workspace/backend/_generated/dataModel";

import {
  contactSessionIdAtomFamily,
  organizationIdAtom,
  screenAtom,
} from "../../atoms/widget-atoms";

const formSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name"),
  email: z.string().trim().email("Please enter a valid email address"),
});

type FormValues = z.infer<typeof formSchema>;

export const WidgetAuthScreen = () => {
  const organizationId = useAtomValue(organizationIdAtom);
  const setScreen = useSetAtom(screenAtom);

  const setContactSessionId = useSetAtom(
    contactSessionIdAtomFamily(organizationId || "")
  );

  const createContactSession = useMutation(
    api.public.contactSessions.create
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      email: "",
    },
  });

  const onSubmit = async (values: FormValues) => {
    if (!organizationId) {
      form.setError("root", {
        message: "Support is currently unavailable. Please try again later.",
      });
      return;
    }

    try {
      const metadata: Doc<"contactSessions">["metadata"] = {
        userAgent: navigator.userAgent,
        language: navigator.language,
        languages: navigator.languages?.join(","),
        platform: navigator.platform,
        vendor: navigator.vendor,
        screenResolution: `${screen.width}x${screen.height}`,
        viewportSize: `${window.innerWidth}x${window.innerHeight}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timezoneOffset: new Date().getTimezoneOffset(),
        cookieEnabled: navigator.cookieEnabled,
        referrer: document.referrer || "direct",
        currentUrl: window.location.href,
      };

      const contactSessionId = await createContactSession({
        ...values,
        organizationId,
        metadata,
      });

      setContactSessionId(contactSessionId);
      setScreen("selection");
    } catch {
      form.setError("root", {
        message: "We couldn't start your session. Please try again.",
      });
    }
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 bg-muted/50 p-5 sm:p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        {/* Brand */}
        <div className="flex items-center gap-2 self-center font-medium">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <MessageCircle className="size-4" />
          </div>
          <span className="tracking-tight">AgentBridge AI</span>
        </div>

        {/* Login-style card */}
        <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col gap-2 p-6 text-center">
            <h1 className="text-xl font-semibold tracking-tight">
              Let&apos;s connect
            </h1>
            <p className="text-sm leading-5 text-muted-foreground">
Fill out the form to reach our support team.            </p>
          </div>

          <div className="px-6 pb-6">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="flex flex-col gap-4"
              >
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="flex flex-col gap-2">
                      <label
                        htmlFor="contact-name"
                        className="text-sm font-medium leading-none"
                      >
                        Full name
                      </label>
                      <FormControl>
                        <Input
                          {...field}
                          id="contact-name"
                          placeholder="Alex Morgan"
                          autoComplete="name"
                          disabled={form.formState.isSubmitting}
                          className="h-10 bg-background"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem className="flex flex-col gap-2">
                      <label
                        htmlFor="contact-email"
                        className="text-sm font-medium leading-none"
                      >
                        Email address
                      </label>
                      <FormControl>
                        <Input
                          {...field}
                          id="contact-email"
                          type="email"
                          placeholder="alex@company.com"
                          autoComplete="email"
                          disabled={form.formState.isSubmitting}
                          className="h-10 bg-background"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {form.formState.errors.root?.message && (
                  <p
                    role="alert"
                    className="text-sm font-medium text-destructive"
                  >
                    {form.formState.errors.root.message}
                  </p>
                )}

                <Button
                  type="submit"
                  className="mt-1 h-10 w-full"
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting
                    ? "Connecting..."
                    : "Continue"}
                </Button>
              </form>
            </Form>
          </div>
        </div>

        {/* Footer */}
        <p className="px-3 text-center text-xs leading-5 text-muted-foreground">
          Your contact details help our team manage your support conversation.
        </p>

        <div className="text-center text-xs text-muted-foreground">
          Powered by AgentBridge AI
        </div>
      </div>
    </div>
  );
};
