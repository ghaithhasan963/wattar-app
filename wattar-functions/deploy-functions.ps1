param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,
  [switch]$Yes,
  [string[]]$FunctionsToDeploy
)

$ErrorActionPreference = 'Stop'
$functionsSource = Join-Path $PSScriptRoot 'functions'
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "wattar-supabase-$([guid]::NewGuid().ToString('N'))"
$supabaseRoot = Join-Path $tempRoot 'supabase'
$functionsTarget = Join-Path $supabaseRoot 'functions'

$availableFunctions = @(
  'wallet',
  'deposit-request',
  'deposit-approve',
  'withdrawal-request',
  'withdrawal-approve',
  'transfer',
  'gift-send',
  'daily-bonus',
  'room-join',
  'room-leave',
  'room-manage-action',
  'livekit-token',
  'game-wheel',
  'game-dice',
  'game-aviator',
  'game-plinko',
  'game-slots',
  'admin-create-agent',
  'admin-create-support',
  'admin-create-host',
  'agent-phone-login',
  'admin-set-agent-status',
  'host-application-review',
  'admin-manage-host',
  'admin-set-rtp',
  'admin-set-user-status',
  'admin-force-outcome',
  'admin-credit-agent',
  'social-push',
  'delete-account',
  'auth-send-phone-otp',
  'auth-sign-up-email',
  'admin-delete-user',
  'admin-reset-user-password',
  'admin-moderation',
  'admin-agencies'
)
$confirmationArgs = @()
if ($Yes) {
  $confirmationArgs = @('--yes')
}

$functions = @($availableFunctions)
if ($FunctionsToDeploy) {
  $unknownFunctions = @($FunctionsToDeploy | Where-Object { $_ -notin $availableFunctions })
  if ($unknownFunctions.Count -gt 0) {
    throw "Unknown function name(s): $($unknownFunctions -join ', ')"
  }
  $functions = @($FunctionsToDeploy | Select-Object -Unique)
}

try {
  New-Item -ItemType Directory -Path $functionsTarget -Force | Out-Null
  Copy-Item -Path (Join-Path $functionsSource '*') -Destination $functionsTarget -Recurse -Force
  Set-Content -Path (Join-Path $supabaseRoot 'config.toml') -Value 'project_id = "wattar"' -Encoding ascii

  foreach ($functionName in $functions) {
    Write-Host "Deploying $functionName..."
    Push-Location $tempRoot
    try {
      & npx --yes supabase@latest functions deploy $functionName --no-verify-jwt --use-api --remote=$ProjectRef @confirmationArgs
      if ($LASTEXITCODE -ne 0) {
        throw "Supabase CLI failed while deploying $functionName (exit code $LASTEXITCODE)."
      }
    }
    finally {
      Pop-Location
    }
  }

  Write-Host "All $($functions.Count) Edge Functions deployed successfully."
  Write-Host "To enable LiveKit audio, configure LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET with: npx --yes supabase@latest secrets set LIVEKIT_URL=... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... --project-ref $ProjectRef"
}
finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
