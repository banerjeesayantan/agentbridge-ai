"use client";

import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { GemIcon } from "lucide-react";
import { useRouter } from "next/navigation";

interface UpgradeWallProps {
  open: boolean;
  reason?: string;
  onOpenChange: (open: boolean) => void;
}

export const UpgradeWall = ({
  open,
  reason,
  onOpenChange,
}: UpgradeWallProps) => {
  const router = useRouter();

  const handleUpgrade = () => {
    onOpenChange(false);
    router.push("/billing");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="items-center text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-full border bg-muted">
            <GemIcon className="size-6 text-muted-foreground" />
          </div>

          <DialogTitle>Upgrade your plan</DialogTitle>

          <DialogDescription>
            {reason ||
              "You've reached the usage limit available on your current plan. Upgrade to continue using this feature."}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/50 p-4 text-center">
          <p className="text-sm font-medium">
            Unlock more AgentBridge capabilities
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Explore available plans and choose the allowance that fits your
            organization.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Not now
          </Button>

          <Button onClick={handleUpgrade}>View plans</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
