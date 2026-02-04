import { cn } from "@/lib/utils";

interface BottorLogoProps {
  size?: number;
  className?: string;
}

export function BottorLogo({ size = 36, className }: BottorLogoProps) {
  return (
    <svg
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      className={cn("flex-shrink-0", className)}
    >
      <rect width="128" height="128" rx="28" fill="#059669" />
      <path
        d="M44 32V96"
        stroke="white"
        strokeWidth="10"
        strokeLinecap="round"
      />
      <path
        d="M44 32H62C72 32 80 40 80 50C80 60 72 68 62 68H44"
        stroke="white"
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M44 68H66C76 68 84 76 84 86C84 94 78 96 66 96H44"
        stroke="white"
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="100" cy="100" r="22" fill="white" />
      <path
        d="M90 100L96 106L110 92"
        stroke="#059669"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
