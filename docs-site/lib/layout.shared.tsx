import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, repoUrl } from './shared';

function Wordmark() {
  return (
    <>
      {/* The wordmark ships as outlined SVG so it never re-typesets in a live font. */}
      <img src="/brand/two42-wordmark.svg" alt={appName} width={108} height={28} className="h-7 w-auto dark:hidden" />
      <img
        src="/brand/two42-wordmark-dark.svg"
        alt={appName}
        width={108}
        height={28}
        className="hidden h-7 w-auto dark:block"
      />
      <span className="ms-1 text-fd-muted-foreground">docs</span>
    </>
  );
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: { title: <Wordmark /> },
    githubUrl: repoUrl,
  };
}
