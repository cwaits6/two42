#!/bin/sh
# Vercel "Ignored Build Step" for both projects: exit 0 skips the build, exit 1 builds.
# Arguments are the pathspecs (relative to the project's root directory) whose
# changes need a build.
#
# A skipped build still reports a green "Vercel" status on the commit. A draft PR
# can't merge, and .github/workflows/vercel-ready.yml builds the head again for
# both projects when the PR is marked ready, so the green status a merge relies on
# comes from a real build.

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
