export function PageBanner({
  title,
  lede,
}: {
  title: string;
  lede?: string;
}) {
  return (
    <header className="-mx-4 mb-8 bg-white px-4 py-8 text-[#181818] md:-mx-8 md:px-8">
      <h1 className="text-4xl leading-none font-medium tracking-[-0.04em] md:text-5xl">{title}</h1>
      {lede ? <p className="mt-3 max-w-2xl text-sm text-[#666666]">{lede}</p> : null}
    </header>
  );
}
