# 一键部署到 GitHub Pages
# 用法: .\deploy.ps1 -GitHubUsername "你的用户名" [-RepoName "resume-tracker"]

param(
    [Parameter(Mandatory = $true)]
    [string]$GitHubUsername,

    [string]$RepoName = "resume-tracker"
)

$ErrorActionPreference = "Stop"
$projectDir = $PSScriptRoot

# 查找 Git
$git = @(
    "$env:ProgramFiles\Git\bin\git.exe",
    "$env:ProgramFiles(x86)\Git\bin\git.exe",
    "$env:LOCALAPPDATA\Programs\Git\bin\git.exe",
    "git"
) | Where-Object { if ($_ -eq "git") { $null -ne (Get-Command git -ErrorAction SilentlyContinue) } else { Test-Path $_ } } | ForEach-Object {
    if ($_ -eq "git") { "git" } else { $_ }
} | Select-Object -First 1

if (-not $git) {
    Write-Host "未找到 Git，请先安装: https://git-scm.com/download/win" -ForegroundColor Red
    exit 1
}

Set-Location $projectDir
Write-Host "项目目录: $projectDir" -ForegroundColor Cyan
Write-Host "GitHub 用户: $GitHubUsername" -ForegroundColor Cyan
Write-Host "仓库名称: $RepoName" -ForegroundColor Cyan
Write-Host ""

$remoteUrl = "https://github.com/$GitHubUsername/$RepoName.git"
$pageUrl = "https://$GitHubUsername.github.io/$RepoName/"

if (-not (Test-Path ".git")) {
    Write-Host "[1/4] 初始化 Git 仓库..." -ForegroundColor Yellow
    & $git init
    & $git branch -M main
} else {
    Write-Host "[1/4] Git 仓库已存在，跳过初始化" -ForegroundColor Green
}

Write-Host "[2/4] 提交代码..." -ForegroundColor Yellow
& $git add .
$status = & $git status --porcelain
if ($status) {
    & $git commit -m "Deploy: 简历投递记录 PWA"
} else {
    Write-Host "没有新的更改需要提交" -ForegroundColor Gray
}

Write-Host "[3/4] 配置远程仓库..." -ForegroundColor Yellow
$existingRemote = & $git remote get-url origin 2>$null
if ($LASTEXITCODE -ne 0) {
    & $git remote add origin $remoteUrl
} elseif ($existingRemote -ne $remoteUrl) {
    & $git remote set-url origin $remoteUrl
}

Write-Host "[4/4] 推送到 GitHub..." -ForegroundColor Yellow
Write-Host "请确保已在 GitHub 创建空仓库: $remoteUrl" -ForegroundColor Gray
& $git push -u origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "推送成功!" -ForegroundColor Green
    Write-Host ""
    Write-Host "接下来请在 GitHub 开启 Pages:" -ForegroundColor Cyan
    Write-Host "  1. 打开 https://github.com/$GitHubUsername/$RepoName/settings/pages"
    Write-Host "  2. Source 选择 GitHub Actions"
    Write-Host "  3. 等待 Actions 部署完成 (约 1-2 分钟)"
    Write-Host ""
    Write-Host "部署完成后访问:" -ForegroundColor Green
    Write-Host "  $pageUrl"
} else {
    Write-Host ""
    Write-Host "推送失败。常见原因:" -ForegroundColor Red
    Write-Host "  - GitHub 上尚未创建仓库 $RepoName"
    Write-Host "  - 未完成 GitHub 登录授权"
    Write-Host ""
    Write-Host "请查看 DEPLOY.md 获取详细说明" -ForegroundColor Yellow
}
