"use client";

import { use, useEffect, useState } from "react";

import { WidgetView } from "@/modules/widget/ui/views/widget-view";

interface Props {
  searchParams: Promise<{
    organizationId: string;
  }>
};

const Page = ({ searchParams }: Props) => {
  const { organizationId } = use(searchParams);
  const [installToken, setInstallToken] = useState<string | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("installToken");
    setInstallToken(token);
  }, []);

  return (
    <WidgetView organizationId={organizationId} installToken={installToken} />
  );
};

export default Page;
