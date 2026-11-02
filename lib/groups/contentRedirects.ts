/**
 * Group settings URLs for content that leaders edit on the pages members read.
 * Bookmarks and emailed links use them. Permanent, so the POST from an editor
 * left open on the old URL keeps its method and body through the redirect.
 */
export const CONTENT_REDIRECTS = [
  {
    source: "/g/:groupId/settings/announcements/:path*",
    destination: "/g/:groupId/announcements/:path*",
    permanent: true,
  },
  {
    source: "/g/:groupId/settings/lectures/:path*",
    destination: "/g/:groupId/lectures/:path*",
    permanent: true,
  },
  {
    source: "/g/:groupId/settings/about",
    destination: "/g/:groupId/about/edit",
    permanent: true,
  },
  {
    source: "/g/:groupId/settings/about/save",
    destination: "/g/:groupId/about/save",
    permanent: true,
  },
  {
    source: "/g/:groupId/settings/giving",
    destination: "/g/:groupId/give",
    permanent: true,
  },
];
