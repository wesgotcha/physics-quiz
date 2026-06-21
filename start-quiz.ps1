$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = if ($env:PORT) { [int]$env:PORT } else { 3000 }
$Url = "http://localhost:$Port/"
$HealthUrl = "http://localhost:$Port/api/chapters"

function Test-QuizServer {
  try {
    Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 1 | Out-Null
    return $true
  } catch {
    return $false
  }
}

Set-Location -LiteralPath $Root

if (-not (Test-QuizServer)) {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-Host 'Node.js was not found. Please install Node.js or make sure the node command is available.'
    Read-Host 'Press Enter to exit'
    exit 1
  }

  $command = "Set-Location -LiteralPath '$Root'; `$env:PORT='$Port'; node server.js"
  Start-Process powershell.exe -ArgumentList @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-NoExit',
    '-Command', $command
  ) -WorkingDirectory $Root -WindowStyle Minimized

  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 300
    if (Test-QuizServer) {
      $ready = $true
      break
    }
  }

  if (-not $ready) {
    Start-Process $Url
    Write-Host "Server may still be starting. Opened: $Url"
    exit 0
  }
}

Start-Process $Url
