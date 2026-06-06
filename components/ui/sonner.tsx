"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--foreground)",
          "--normal-text": "var(--background)",
          "--normal-border": "color-mix(in oklch, var(--foreground) 78%, var(--primary) 22%)",
          "--success-bg": "var(--foreground)",
          "--success-text": "var(--background)",
          "--success-border": "var(--success)",
          "--error-bg": "var(--foreground)",
          "--error-text": "var(--background)",
          "--error-border": "var(--destructive)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast !shadow-xl",
          title: "!font-semibold",
          description: "!text-background/75",
          actionButton: "!bg-primary !text-primary-foreground !shadow-sm",
          cancelButton: "!bg-background/10 !text-background",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
