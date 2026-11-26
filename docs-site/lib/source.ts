import { loader } from 'fumadocs-core/source';
import { defineDocs } from 'fumadocs-mdx/macro';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { z } from 'zod';
import { docsRoute } from './shared';

const docs = defineDocs({
  dir: 'content/docs',
  // scripts/docs-sources.mjs reads `sources` from the raw frontmatter, so
  // pages write it as a block list (see README.md).
  docs: { schema: pageSchema.extend({ sources: z.array(z.string().min(1)).min(1).optional() }) },
  meta: { schema: metaSchema },
});

export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
});
