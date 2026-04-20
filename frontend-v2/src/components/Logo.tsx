export default function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`brand-row ${className}`}>
      <div className="brand-mark">C</div>
      <div className="brand-name">Cursus</div>
    </div>
  );
}
