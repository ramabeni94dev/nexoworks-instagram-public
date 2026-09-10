$ErrorActionPreference = 'Stop'
$taskName = 'NexoWorks Instagram Public - Actualizar widgets'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$workerEnvironment = Join-Path $projectRoot '.env.worker'
if (-not (Test-Path -LiteralPath $workerEnvironment)) { throw 'Falta .env.worker con BLOB_READ_WRITE_TOKEN y CHROMIUM_EXECUTABLE_PATH.' }
$null = Get-Command node.exe -ErrorAction Stop
$runner = Join-Path $PSScriptRoot 'run-worker-task.ps1'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.Actions.WorkingDirectory -ne $projectRoot) { throw 'Existe una tarea con ese nombre para otra carpeta. No se modifico.' }
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $runner
$action = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument $arguments -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(15) -RepetitionInterval (New-TimeSpan -Minutes 15)
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Actualiza los widgets de Instagram Public desde $projectRoot. Revisa pedidos cada 15 minutos y feeds vencidos segun .env.worker." -Force | Select-Object TaskName, State
