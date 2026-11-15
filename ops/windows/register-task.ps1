$ErrorActionPreference = 'Stop'
$deploymentRoot = $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $deploymentRoot 'config.json') -Raw | ConvertFrom-Json
$taskName = 'AI-WQS Local Server Update'
$scriptPath = Join-Path $deploymentRoot 'update-windows.py'
if (-not (Test-Path -LiteralPath $config.pythonw)) {
    throw 'Python runtime is missing. Update python/pythonw paths in config.json.'
}
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask -and ($existingTask.Actions.Arguments -notlike ('*' + $scriptPath + '*'))) {
    throw 'A task with this name already belongs to another installation.'
}
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$action = New-ScheduledTaskAction -Execute $config.pythonw -Argument ('"' + $scriptPath + '" update') -WorkingDirectory $deploymentRoot
$minuteTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$loginTrigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
$principal = New-ScheduledTaskPrincipal -UserId $identity.User.Value -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -Hidden
Register-ScheduledTask -TaskName $taskName -Description 'Check the configured public GitHub branch every minute; deploy only exact successful push CI; back up SQLite daily and before upgrades.' -Action $action -Trigger @($minuteTrigger, $loginTrigger) -Principal $principal -Settings $settings -Force | Select-Object TaskName,State
Export-ScheduledTask -TaskName $taskName | Set-Content -LiteralPath (Join-Path $deploymentRoot 'scheduled-task.xml') -Encoding utf8
