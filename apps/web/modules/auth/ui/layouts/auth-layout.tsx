import Image from "next/image"
import Link from "next/link"

export const AuthLayout = ({
  children,
}: {
  children: React.ReactNode
}) => {
  return (
    <div className="flex min-h-screen min-w-full flex-col items-center justify-center gap-y-6 px-4 py-8">
      <Link href="/" className="flex items-center gap-3">
        <Image
          alt="AgentBridge AI"
          height={44}
          width={44}
          src="/logo.png"
          priority
        />
        <span className="text-xl font-semibold tracking-tight">
          AgentBridge AI
        </span>
      </Link>
      {children}
    </div>
  )
}