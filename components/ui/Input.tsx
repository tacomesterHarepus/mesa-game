interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, className = "", id, ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="label-caps">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`bg-deep border border-border rounded px-3 py-2 text-primary text-sm font-mono placeholder:text-faint focus:outline-none focus:border-amber transition-colors ${className}`}
        {...props}
      />
    </div>
  );
}
