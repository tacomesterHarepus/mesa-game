"use client";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  variant?: "primary" | "secondary" | "danger";
}

export function Button({
  loading,
  variant = "primary",
  className = "",
  children,
  disabled,
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center px-4 py-2 text-xs font-mono tracking-widest uppercase rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const variants = {
    primary:
      "bg-amber text-deep hover:bg-amber-dim border border-amber",
    secondary:
      "bg-transparent text-primary border border-border hover:border-muted",
    danger:
      "bg-transparent text-virus border border-virus-line hover:bg-virus-bg",
  };
  return (
    <button
      className={`${base} ${variants[variant]} ${className}`}
      disabled={disabled ?? loading}
      {...props}
    >
      {loading ? <span className="opacity-60">···</span> : children}
    </button>
  );
}
