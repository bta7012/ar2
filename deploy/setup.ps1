# One-time CI/CD setup for bta7012/ar2.
# Run from PowerShell:  powershell -ExecutionPolicy Bypass -File C:\project\ar2\deploy\setup.ps1
# Uses YOUR existing SSH key (C:\Users\<you>\.ssh) to install a separate deploy key on the server.

$ErrorActionPreference = 'Stop'
$Root   = Split-Path $PSScriptRoot -Parent
Set-Location $Root

$SrvHost = '138.201.50.242'
$SrvPort = 32308
$SrvUser = 'prjadm'
$Path    = '/var/www/ar2'
$Repo    = 'bta7012/ar2'
$Key     = Join-Path $Root '.deploy\ar2_deploy_key'

if (-not (Test-Path $Key)) { throw "Deploy key not found: $Key" }
# Windows OpenSSH refuses keys readable by other users
icacls $Key /inheritance:r /grant:r "$($env:USERNAME):(R)" | Out-Null

# ---------------------------------------------------------------- 1
Write-Host "`n[1/5] Installing deploy key on $SrvUser@$SrvHost (your own key / password is used)..." -ForegroundColor Cyan
$pub = (Get-Content "$Key.pub" -Raw).Trim()
$remote = "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && " +
          "(grep -qF '$pub' ~/.ssh/authorized_keys || echo '$pub' >> ~/.ssh/authorized_keys) && " +
          "(mkdir -p $Path 2>/dev/null; test -w $Path && echo 'OK: $Path writable' || echo 'WARN: $Path is not writable by $SrvUser -> run: sudo mkdir -p $Path && sudo chown -R ${SrvUser}: $Path')"
ssh -p $SrvPort "$SrvUser@$SrvHost" $remote
if ($LASTEXITCODE -ne 0) { throw "SSH to server failed" }

# ---------------------------------------------------------------- 2
Write-Host "`n[2/5] Testing deploy key..." -ForegroundColor Cyan
ssh -i $Key -o IdentitiesOnly=yes -o BatchMode=yes -p $SrvPort "$SrvUser@$SrvHost" "echo 'deploy key works'"
if ($LASTEXITCODE -ne 0) { throw "Deploy key login failed" }

# ---------------------------------------------------------------- 3
Write-Host "`n[3/5] Reading server host key (known_hosts)..." -ForegroundColor Cyan
$kh = (ssh-keyscan -p $SrvPort $SrvHost 2>$null) -join "`n"
if (-not $kh) { throw "ssh-keyscan returned nothing" }
Set-Content -Path (Join-Path $Root '.deploy\known_hosts.txt') -Value $kh -NoNewline

# ---------------------------------------------------------------- 4
Write-Host "`n[4/5] GitHub secrets..." -ForegroundColor Cyan
if (Get-Command gh -ErrorAction SilentlyContinue) {
  gh auth status 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { gh auth login }
  Get-Content $Key -Raw | gh secret set SSH_PRIVATE_KEY -R $Repo
  $kh | gh secret set SSH_KNOWN_HOSTS -R $Repo
  Write-Host "Secrets SSH_PRIVATE_KEY and SSH_KNOWN_HOSTS set." -ForegroundColor Green
} else {
  Write-Host "GitHub CLI (gh) not found. Add secrets manually:" -ForegroundColor Yellow
  Write-Host "  https://github.com/$Repo/settings/secrets/actions -> New repository secret"
  Write-Host "  SSH_PRIVATE_KEY = contents of $Key"
  Write-Host "  SSH_KNOWN_HOSTS = contents of $Root\.deploy\known_hosts.txt"
  Read-Host "Press Enter when both secrets are added"
}

# ---------------------------------------------------------------- 5
Write-Host "`n[5/5] Git commit & push (triggers first deploy)..." -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $Root '.git'))) {
  git init -b main
  git remote add origin "https://github.com/$Repo.git"
}
git add -A
git commit -m "AR wall lamp app + CI/CD deploy to server" 2>$null
git push -u origin main
if ($LASTEXITCODE -ne 0) { throw "git push failed" }

Write-Host "`nDone. Watch the deploy: https://github.com/$Repo/actions" -ForegroundColor Green
Write-Host "After it is green you can delete the private key copy: $Root\.deploy\ar2_deploy_key" -ForegroundColor DarkGray
