param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$cloudflared = Join-Path $root "tools\cloudflared.exe"

if (-not (Test-Path -LiteralPath $cloudflared)) {
    throw "tools\cloudflared.exe がありません。READMEのセットアップ手順を確認してください。"
}

$securePassword = Read-Host "当日用の管理者パスワードを入力してください" -AsSecureString
$passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $adminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr)
}
if ($adminPassword.Length -lt 10) {
    throw "管理者パスワードは10文字以上にしてください。"
}

$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$($existing.OwningProcess)"
    if ($processInfo.CommandLine -notmatch "server\.py") {
        throw "ポート $Port は別のアプリが使用しています。"
    }
    Write-Host "既存の試作サーバーを当日設定で再起動します。" -ForegroundColor Yellow
    Stop-Process -Id $existing.OwningProcess -Force
    Start-Sleep -Seconds 1
}

$env:ADMIN_PASSWORD = $adminPassword
$env:HOST = "127.0.0.1"
$env:PORT = "$Port"
$server = Start-Process -FilePath "py.exe" -ArgumentList "-3", "server.py" -WorkingDirectory $root -WindowStyle Hidden -PassThru

try {
    $ready = $false
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 250
        try {
            $null = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/api/course" -TimeoutSec 2
            $ready = $true
            break
        } catch {}
    }
    if (-not $ready) { throw "ローカルサーバーを起動できませんでした。" }

    Write-Host ""
    Write-Host "公開URLを作成しています…" -ForegroundColor Cyan
    Write-Host "表示された https://～trycloudflare.com のURLをスマートフォンへ共有してください。" -ForegroundColor Green
    Write-Host "この画面を閉じると公開も終了します。終了は Ctrl+C です。" -ForegroundColor Yellow
    Write-Host ""
    & $cloudflared tunnel --url "http://127.0.0.1:$Port" --protocol http2 --no-autoupdate
} finally {
    if ($server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    }
}
