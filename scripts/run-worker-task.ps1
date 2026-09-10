$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
$arguments = '--env-file="{0}" "{1}"' -f (Join-Path $projectRoot '.env.worker'), (Join-Path $PSScriptRoot 'scheduled-refresh.mjs')
$worker = Start-Process -FilePath $nodeCommand -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -Wait
exit $worker.ExitCode
