#!/bin/bash
#
# Git pre-push hook - Block direct pushes to main/master
#
# This hook prevents pushing directly to protected branches without a PR.
# For private repos where GitHub branch protection requires Pro.
#
# Installation: Copy to .git/hooks/pre-push and chmod +x
#
# Bypass (emergency only): git push --no-verify

protected_branches="main master"

while read local_ref local_sha remote_ref remote_sha; do
  # Extract branch name
  if [[ "$remote_ref" =~ refs/heads/(.*) ]]; then
    branch="${BASH_REMATCH[1]}"

    # Check if pushing to protected branch
    for protected in $protected_branches; do
      if [[ "$branch" == "$protected" ]]; then
        echo ""
        echo "❌ Direct push to '$branch' is blocked!"
        echo ""
        echo "This repository requires pull requests for all changes to $protected_branches."
        echo ""
        echo "To push your changes:"
        echo "  1. Create a feature branch: git checkout -b feature/my-feature"
        echo "  2. Push the feature branch: git push -u origin feature/my-feature"
        echo "  3. Create a pull request on GitHub"
        echo ""
        echo "Emergency bypass (NOT RECOMMENDED): git push --no-verify"
        echo ""
        exit 1
      fi
    done
  fi
done

exit 0
