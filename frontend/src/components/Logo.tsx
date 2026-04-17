export default function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <span className="inline-block w-6 h-6 rounded-card bg-matcha-600 border border-black" />
      <span className="font-semibold tracking-tight text-lg">Study Buddy</span>
    </div>
  );
}
