export function Logo({ className = 'size-6' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 36 36" aria-hidden="true">
      <path
        d="M18 3C9.7 3 3 9.1 3 16.6c0 3.1 1.2 6 3.2 8.3L5 32.2a.7.7 0 0 0 1 .8l6.9-3.3c1.6.5 3.3.8 5.1.8 8.3 0 15-6.1 15-13.6S26.3 3 18 3Z"
        fill="var(--brand)"
      />
      <rect
        x="11"
        y="17"
        width="3.4"
        height="6"
        rx="1.2"
        fill="var(--brand-fg)"
      />
      <rect
        x="16.3"
        y="13.5"
        width="3.4"
        height="9.5"
        rx="1.2"
        fill="var(--brand-fg)"
      />
      <rect
        x="21.6"
        y="9.8"
        width="3.4"
        height="13.2"
        rx="1.2"
        fill="var(--brand-fg)"
      />
    </svg>
  )
}
