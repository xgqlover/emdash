$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Normalise MSYS2/Git Bash /c/... style paths to Windows C:\... style
if ($ScriptDir -notmatch '^[a-zA-Z]:[\\/]' -and $ScriptDir -match '^/([a-zA-Z])/(.*)') {
    $ScriptDir = "$($matches[1]):\$($matches[2] -replace '/', '\')"
}

$env:NSISDIR = Join-Path $ScriptDir "windows"

$Makensis = Join-Path $env:NSISDIR "makensis.exe"
if (-not (Test-Path $Makensis)) {
    Write-Error "makensis.exe not found at: $Makensis"
    exit 1
}

& $Makensis @args
exit $LASTEXITCODE
