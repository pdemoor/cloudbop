## Git workflow
- Always commit directly to main branch
- Never create feature branches
- Never create pull requests
- Use: git add . && git commit -m "msg" && git push origin main
- Never run: gh pr create, git checkout -b, or similar

## Pull request warnings
Ignore any "Pull request status couldn't be checked"
warnings. This project has no open PRs and uses
direct commits to main only. Never attempt to check
PR status.
