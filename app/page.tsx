import { LandingCta, PublicToolList } from "@/components/landing";
import { Logo } from "@/components/logo";

const STEPS = [
  {
    title: "List what you own",
    body: "Add the drill, ladder, or tent that spends most of the year on a shelf.",
  },
  {
    title: "Request what you need",
    body: "Pick the dates. The owner gets a notification and approves or declines.",
  },
  {
    title: "Return it on time",
    body: "LendLoop sends a friendly reminder if something is overdue.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <Logo />
        <LandingCta />
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6">
        <section className="py-16 sm:py-24">
          <p className="mb-4 text-sm font-medium text-accent">
            Your neighborhood tool library
          </p>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            Borrow what you need. Lend what you don&rsquo;t.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            LendLoop is a shared board where neighbors list the tools they&rsquo;re
            happy to lend and borrow the ones they&rsquo;d rather not buy.
          </p>
          <div className="mt-8">
            <LandingCta large />
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <div key={step.title} className="rounded-xl border border-line bg-surface p-5">
              <span className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent-strong">
                {index + 1}
              </span>
              <h2 className="mt-3 font-medium">{step.title}</h2>
              <p className="mt-1 text-sm text-muted">{step.body}</p>
            </div>
          ))}
        </section>

        <section className="py-16">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold tracking-tight">Available right now</h2>
            <p className="mt-1 text-sm text-muted">
              Sign in to see who&rsquo;s lending and request a tool.
            </p>
          </div>
          <PublicToolList />
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-5xl px-6 py-6 text-sm text-muted">
          LendLoop · Borrow what you need. Lend what you don&rsquo;t.
        </div>
      </footer>
    </div>
  );
}
