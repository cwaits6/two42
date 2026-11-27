#!/bin/sh
# Vercel "Ignored Build Step" for both projects: exit 0 skips the build, exit 1 builds.
# The argument names the project: "app" (run from the repo root) or "docs" (run
# from docs-site/). Each project builds only when files it is built from change.
#
# A skipped build still reports a green "Vercel" status on the commit. A draft PR
# can't merge, and .github/workflows/vercel-ready.yml builds the head again for
# both projects when the PR is marked ready, so the green status a merge relies on
# comes from a real build.

case "$1" in
  # The app imports supabase/functions/_shared, but nothing else under supabase/:
  # migrations, the schema dump, tests, seed data and the edge function entry points.
  app)
    set -- . ':(exclude)docs-site' \
      ':(exclude,glob)supabase/*' ':(exclude,glob)supabase/[!f]*/**' \
      ':(exclude,glob)supabase/functions/*' ':(exclude,glob)supabase/functions/[!_]*/**' ;;
  docs) set -- . ;;
  *) echo "Unknown project '$1': building."; exit 1 ;;
esac

if [ "$VERCEL_ENV" = "preview" ] && [ -n "$VERCEL_GIT_PULL_REQUEST_ID" ]; then
  # The repo is public, so this needs no token. Any failure falls through to the
  # path check below, so an unreachable API never blocks a build.
  pr=$(curl -fsS --max-time 10 \
    "https://api.github.com/repos/${VERCEL_GIT_REPO_OWNER}/${VERCEL_GIT_REPO_SLUG}/pulls/${VERCEL_GIT_PULL_REQUEST_ID}" 2>/dev/null)
  if printf '%s' "$pr" | grep -Eq '"draft": *true'; then
    echo "Draft PR #${VERCEL_GIT_PULL_REQUEST_ID}: skipping the preview build."
    exit 0
  fi
fi

# VERCEL_GIT_PREVIOUS_SHA is the last successful deployment's commit, so commits
# skipped above are still inside this diff. With no successful deployment yet,
# nothing proves the earlier commits were built, so build.
P=${VERCEL_GIT_PREVIOUS_SHA:-}
if [ -n "$P" ] && git cat-file -e "$P^{commit}" 2>/dev/null && git diff --quiet "$P" HEAD -- "$@"; then
  echo "Nothing this project builds from changed. Skipping the build."
  exit 0
fi
exit 1
