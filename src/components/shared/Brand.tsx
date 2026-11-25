import { Link } from 'react-router-dom'
export default function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand" to="/today" aria-label="Muscle Memory home">
      <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <path
          d="M7 29V11L20 24l13-13v18M15 11l5 5 5-5"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinejoin="round"
        />
      </svg>
      {!compact && (
        <span>
          muscle
          <span className="brand-second">
            memory<span className="brand-period">.</span>
          </span>
        </span>
      )}
    </Link>
  )
}
