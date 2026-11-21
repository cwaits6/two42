import Link from 'next/link';

const sections = [
  {
    href: '/docs/use',
    title: 'Use two42',
    reader: 'Members and leaders',
    body: 'Sign in, join a group, and use the calendar, serving, directory, prayer, lessons and giving pages.',
  },
  {
    href: '/docs/administer',
    title: 'Administer',
    reader: 'Church admins and leaders',
    body: 'Approve people, set up groups, households, teams and invite links, and brand your church.',
  },
  {
    href: '/docs/run',
    title: 'Run two42',
    reader: 'Operators',
    body: 'Host your own copy: Supabase, a Next.js host, environment variables, email and releases.',
  },
  {
    href: '/docs/develop',
    title: 'Develop',
    reader: 'Contributors',
    body: 'How the app is built, the local checks, and the contributor docs in the repository.',
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="font-serif text-4xl font-semibold">two42 documentation</h1>
      <p className="mt-3 text-lg text-fd-muted-foreground">Pick the section for what you do in two42.</p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {sections.map((section) => (
          <li key={section.href}>
            <Link
              href={section.href}
              className="block h-full rounded-xl border border-fd-border bg-fd-card p-6 transition-colors hover:border-fd-primary focus-visible:outline-2 focus-visible:outline-fd-ring"
            >
              <span className="text-sm font-medium text-fd-muted-foreground">{section.reader}</span>
              <span className="mt-1 block font-serif text-2xl font-semibold text-fd-primary">{section.title}</span>
              <span className="mt-2 block">{section.body}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
