import { loader } from 'fumadocs-core/source';
import { defineDocs } from 'fumadocs-mdx/macro';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { z } from 'zod';
import { docsRoute } from './shared';

const docs = defineDocs({
  dir: 'content/docs',
  docs: { schema: pageSchema.extend({ sources: z.array(z.string().min(1)).min(1).optional() }) },
  meta: { schema: metaSchema },
});

export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
});
