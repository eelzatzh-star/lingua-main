$ErrorActionPreference = 'Stop'

Write-Host "=== Lingua Bridge Family: upload to GitHub ===" -ForegroundColor Cyan

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "Git is not installed. Install Git for Windows from https://git-scm.com/download/win and reopen PowerShell." -ForegroundColor Red
  exit 1
}

$repoUrl = Read-Host "Paste the HTTPS URL of your EMPTY GitHub repository (e.g. https://github.com/username/lingua-bridge-family.git)"
if ([string]::IsNullOrWhiteSpace($repoUrl) -or $repoUrl -notmatch '^https://github\.com/.+/.+\.git$') {
  Write-Host "That URL does not look like a GitHub HTTPS repository URL." -ForegroundColor Red
  exit 1
}

if (-not (Test-Path ".git")) {
  git init
  if ($LASTEXITCODE -ne 0) { throw "git init failed" }
}

git branch -M main
if ($LASTEXITCODE -ne 0) { throw "Could not set the main branch" }

git add -A
if ($LASTEXITCODE -ne 0) { throw "git add failed" }

git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host "No new changes to commit; proceeding with push." -ForegroundColor Yellow
} else {
  git commit -m "Publish Lingua Bridge Family website"
  if ($LASTEXITCODE -ne 0) { throw "git commit failed. Check your Git name/email configuration." }
}

$remotes = git remote
if ($remotes -contains "origin") {
  git remote set-url origin $repoUrl
} else {
  git remote add origin $repoUrl
}
if ($LASTEXITCODE -ne 0) { throw "Could not configure the origin remote" }

git push -u origin main
if ($LASTEXITCODE -ne 0) {
  Write-Host "Push failed. Confirm you're signed in to GitHub and that the repository is empty and accessible." -ForegroundColor Red
  exit 1
}

Write-Host "Upload complete. Your source code is now in GitHub." -ForegroundColor Green
Write-Host "Next: create a Render Blueprint from this repository to publish the live site." -ForegroundColor Cyan
