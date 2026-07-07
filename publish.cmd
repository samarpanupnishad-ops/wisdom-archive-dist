@echo off
cd /d D:\wisdom-archive-dist
echo === Adding files (please wait, ~5-10 min) ===
git add -A
git commit -m "First mobile update payload (986 entries, v8.15)"
echo === Pushing ~288 MB to GitHub (this can take a long time) ===
git push
echo.
echo ===== FINISHED - you can close this window =====
pause
