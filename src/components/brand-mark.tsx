export function BrandMark({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span
      className={`inline-block leading-none font-medium tracking-tight ${
        size === "lg" ? "text-6xl" : "text-2xl"
      }`}
    >
      Ruyah
    </span>
  );
}
