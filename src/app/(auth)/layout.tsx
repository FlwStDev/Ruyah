import { ThemeToggle } from "@/components/theme-toggle";
import { BrandMark } from "@/components/brand-mark";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen bg-[#181818] text-white lg:grid-cols-2">
      <section className="hidden flex-col justify-between p-16 lg:flex">
        <BrandMark size="lg" />
        <div className="max-w-xl">
          <h1 className="text-6xl leading-[1.05] font-medium tracking-[-0.04em]">Write it once.</h1>
          <p className="mt-6 max-w-sm text-sm leading-relaxed text-[#969696]">
            Then send that draft to the networks you already use. It stays on this computer.
          </p>
        </div>
        <p className="text-xs tracking-[0.14em] text-[#666666] uppercase">X · Reddit · Instagram</p>
      </section>
      <section className="relative flex items-center justify-center bg-white px-6 py-16 text-[#181818]">
        <div className="absolute top-6 right-6">
          <ThemeToggle />
        </div>
        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden">
            <BrandMark size="lg" />
          </div>
          {children}
        </div>
      </section>
    </div>
  );
}
