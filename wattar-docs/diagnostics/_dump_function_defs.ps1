$ErrorActionPreference = 'Stop'
$outDir = Join-Path $env:TEMP 'wattar-func-defs'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$funcs = @(
  'follow_wattar_user',
  'send_friend_request',
  'list_active_stories',
  'create_private_conversation',
  'get_private_message_quote',
  'send_private_message'
)
foreach ($f in $funcs) {
  $sql = "select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='$f' order by pg_get_function_identity_arguments(p.oid) desc limit 1"
  $tmp = Join-Path $env:TEMP "def-$f.sql"
  Set-Content -Path $tmp -Value $sql -Encoding utf8
  $raw = & npx supabase db query --remote=vczyjbqixqzositlkfkn --read-only -f $tmp --output json 2>$null
  $json = ($raw | Where-Object { $_ -match '^\s*\{' -or $_ -match '"' }) -join "`n"
  try {
    $obj = $json | ConvertFrom-Json
    $def = $obj.rows[0].def
    if (-not $def) { throw 'no def' }
    Set-Content -Path (Join-Path $outDir "$f.sql") -Value $def -Encoding utf8
    Write-Output "$f OK $($def.Length) chars"
  } catch {
    Write-Output "$f FAILED: $($_.Exception.Message)"
  }
}
Write-Output "OUT=$outDir"
