export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <svg
        className="animate-spin h-6 w-6 text-blue-600"
        viewBox="0 0 24 24"
        fill="none"
        aria-label="Loading"
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="4"
        />
        <path
          d="M22 12a10 10 0 0 1-10 10"
          stroke="currentColor"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
