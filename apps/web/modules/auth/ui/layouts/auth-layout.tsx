import Image from "next/image";
import Link from "next/link";

export const AuthLayout = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-8 bg-background px-4 py-10">
      <Link
        href="/"
        className="flex items-center gap-3"
        aria-label="AgentBridge AI home"
      >
        <Image
          src="/AgentBridge_logo.png"
          alt="AgentBridge AI logo"
          width={56}
          height={56}
          priority
          className="size-14 shrink-0 object-contain"
        />

        <span className="text-2xl font-bold tracking-tight">
          AgentBridge AI
        </span>
      </Link>

      {children}
    </div>
  );
};