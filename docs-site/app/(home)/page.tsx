import { source } from '@/lib/source';
import { getMDXComponents } from '@/components/mdx';
import { DocsBody } from 'fumadocs-ui/layouts/docs/page';
import { notFound } from 'next/navigation';

export default function HomePage() {
  const page = source.getPage([]);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="font-serif text-4xl font-semibold">{page.data.title}</h1>
      <p className="mt-3 text-lg text-fd-muted-foreground">{page.data.description}</p>
      <DocsBody className="mt-8">
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </main>
  );
}
