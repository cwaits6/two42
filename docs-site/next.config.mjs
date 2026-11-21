import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

// Pinned so Next does not take the app's lockfile one level up as the
// workspace root and compile the app's files into this site.
const root = import.meta.dirname;

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  reactStrictMode: true,
  turbopack: { root },
  outputFileTracingRoot: root,
};

export default withMDX(config);
