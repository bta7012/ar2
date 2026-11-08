@echo off
rem One-time CI/CD setup for bta7012/ar2 (cmd version).
rem Run:  C:\project\ar2\deploy\setup.cmd
rem Uses YOUR existing SSH key (C:\Users\<you>\.ssh) to install a separate deploy key on the server.
setlocal EnableExtensions
cd /d "%~dp0.."

set "SRV_HOST=138.201.50.242"
set "SRV_PORT=32308"
set "SRV_USER=prjadm"
set "DPATH=/var/www/ar2"
set "REPO=bta7012/ar2"
set "KEY=%CD%\.deploy\ar2_deploy_key"
set "KH=%CD%\.deploy\known_hosts.txt"

where ssh >nul 2>&1 || (echo [ERROR] ssh not found. Install "OpenSSH Client" in Windows optional features. & goto :fail)
where git >nul 2>&1 || (echo [ERROR] git not found. & goto :fail)
if not exist "%KEY%" (echo [ERROR] Deploy key not found: %KEY% & goto :fail)

rem Windows OpenSSH refuses private keys readable by other users
icacls "%KEY%" /inheritance:r /grant:r "%USERNAME%:(R)" >nul

echo.
echo [1/5] Installing deploy key on %SRV_USER%@%SRV_HOST% (your own key / password is used)...
type "%KEY%.pub" | ssh -p %SRV_PORT% %SRV_USER%@%SRV_HOST% "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && cat > /tmp/ar2_deploy.pub && (grep -qxFf /tmp/ar2_deploy.pub ~/.ssh/authorized_keys || cat /tmp/ar2_deploy.pub >> ~/.ssh/authorized_keys) && rm -f /tmp/ar2_deploy.pub && (mkdir -p %DPATH% 2>/dev/null; test -w %DPATH% && echo OK: %DPATH% writable || echo WARN: %DPATH% not writable, run on server: sudo mkdir -p %DPATH% ; sudo chown -R %SRV_USER%: %DPATH%)"
if errorlevel 1 (echo [ERROR] SSH to server failed & goto :fail)

echo.
echo [2/5] Testing deploy key...
ssh -i "%KEY%" -o IdentitiesOnly=yes -o BatchMode=yes -p %SRV_PORT% %SRV_USER%@%SRV_HOST% "echo deploy key works"
if errorlevel 1 (echo [ERROR] Deploy key login failed & goto :fail)

echo.
echo [3/5] Reading server host key...
ssh-keyscan -p %SRV_PORT% %SRV_HOST% > "%KH%" 2>nul
for %%A in ("%KH%") do if %%~zA==0 (echo [ERROR] ssh-keyscan returned nothing & goto :fail)

echo.
echo [4/5] GitHub secrets...
where gh >nul 2>&1
if errorlevel 1 goto :manual_secrets
gh auth status >nul 2>&1 || gh auth login
gh secret set SSH_PRIVATE_KEY -R %REPO% < "%KEY%"
if errorlevel 1 goto :fail
gh secret set SSH_KNOWN_HOSTS -R %REPO% < "%KH%"
if errorlevel 1 goto :fail
echo Secrets SSH_PRIVATE_KEY and SSH_KNOWN_HOSTS set.
goto :git

:manual_secrets
echo GitHub CLI (gh) not found. Add secrets manually:
echo   https://github.com/%REPO%/settings/secrets/actions  -^> New repository secret
echo   SSH_PRIVATE_KEY = contents of %KEY%
echo   SSH_KNOWN_HOSTS = contents of %KH%
echo   (open them with: notepad "%KEY%"  and  notepad "%KH%")
pause

:git
echo.
echo [5/5] Git commit ^& push (triggers first deploy)...
if not exist ".git" (
  git init -b main
  git remote add origin https://github.com/%REPO%.git
)
git add -A
git commit -m "AR wall lamp app + CI/CD deploy to server"
git push -u origin main
if errorlevel 1 (echo [ERROR] git push failed & goto :fail)

echo.
echo Done. Watch the deploy: https://github.com/%REPO%/actions
echo After it is green you can delete the private key copy: %KEY%
exit /b 0

:fail
echo.
echo Setup stopped.
exit /b 1
