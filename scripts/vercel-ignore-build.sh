#!/bin/sh
# Vercel "Ignored Build Step" for both projects: exit 0 skips the build, exit 1 builds.
# The argument names the project: "app" (run from the repo root) or "docs" (run
# from docs-site/). Each project builds only when files it is built from change.

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

# VERCEL_GIT_PREVIOUS_SHA is the last successful deployment's commit, so skipped
# commits are still inside this diff. With no successful deployment yet, nothing
# proves the earlier commits were built, so build.
P=${VERCEL_GIT_PREVIOUS_SHA:-}
if [ -n "$P" ] && git cat-file -e "$P^{commit}" 2>/dev/null && git diff --quiet "$P" HEAD -- "$@"; then
  echo "Nothing this project builds from changed. Skipping the build."
  exit 0
fi
exit 1
