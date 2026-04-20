interface Props {
  n: number;
  onClick: (n: number) => void;
}

export function Citation({ n, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={() => onClick(n)}
      className="inline-flex items-center justify-center mx-0.5 px-1.5 min-w-[1.3rem] h-5 text-[0.7rem] font-medium rounded-pill border border-black bg-oat-light hover:bg-black hover:text-cream transition align-baseline"
      aria-label={`Source ${n}`}
    >
      {n}
    </button>
  );
}
