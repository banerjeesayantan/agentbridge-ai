"use client";

import { api } from "@workspace/backend/_generated/api";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { useQuery } from "convex/react";
import { CheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";

interface UpgradeWallProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Why the user hit the wall, e.g. the backend's limit message. */
  reason?: string;
}

/**
 * Shown when the backend reports LIMIT_REACHED / PLAN_REQUIRED. The benefits
 * listed are the real Pro limits from the entitlement mapping, not marketing copy.
 */
export const UpgradeWall = ({ open, onOpenChange, reason }: UpgradeWallProps) => {
  const router = useRouter();
  const summary = useQuery(api.private.usage.summary);
  const pro = summary?.plans.pro;
  const benefits = pro
    ? [
        `${pro.limits.aiMessages.toLocaleString()} AI messages per billing period`,
        `${pro.limits.knowledgeFiles.toLocaleString()} knowledge-base files`,
        "Advanced feedback and report export",
        `Voice assistant and up to ${pro.limits.members} team members`,
      ]
    : [];

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {summary ? `You've reached your ${summary.planName} plan limit` : "Upgrade to continue"}
          </DialogTitle>
          <DialogDescription>{reason ?? "Upgrade to Pro to continue."}</DialogDescription>
        </DialogHeader>
        {benefits.length > 0 && (
          <ul className="space-y-2 text-sm">
            {benefits.map((b) => (
              <li className="flex items-start gap-2" key={b}>
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                {b}
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
            Not now
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              router.push("/billing#plans");
            }}
            type="button"
          >
            View plans
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
