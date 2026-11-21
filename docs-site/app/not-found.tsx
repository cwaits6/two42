import Link from 'next/link';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';

export default function NotFound() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="font-serif text-4xl font-semibold">Page not found</h1>
        <p className="mt-3 text-lg text-fd-muted-foreground">This page doesn&apos;t exist or has moved.</p>
        <Link href="/docs" className="mt-6 inline-block font-medium text-fd-primary underline underline-offset-4">
          Go to the documentation
        </Link>
      </main>
    </HomeLayout>
  );
}
