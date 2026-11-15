#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$AdminHome,
    [ValidateRange(1024, 65535)]
    [int]$Port = 3200,
    [string]$NodePath,
    [switch]$Remove
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ruleName = 'AI-WQS-LAN-Gateway'
$ruleGroup = 'AI-WQS-LAN'
$ruleDescription = 'Managed by AI-WQS local deployment. Inbound TCP for the configured Node.js gateway, LocalSubnet only.'
$script:safeFailure = 'Firewall setup failed. Check the installed admin home, configured Node.js program, existing rule ownership and administrator rights.'

function Stop-Setup([string]$Message) {
    $script:safeFailure = $Message
    throw [System.InvalidOperationException]::new($Message)
}
function Read-NamedRule([string]$Store) {
    try { @(Get-NetFirewallRule -PolicyStore $Store -Name $ruleName -ErrorAction Stop) }
    catch {
        if ($_.CategoryInfo.Category -ne [System.Management.Automation.ErrorCategory]::ObjectNotFound) { throw }
    }
}
function Assert-OwnedRule($Rule, [string]$Program, [int]$GatewayPort) {
    if ($Rule.Name -cne $ruleName -or $Rule.Group -cne $ruleGroup -or $Rule.Description -cne $ruleDescription) {
        Stop-Setup 'The named firewall rule belongs to another configuration; it was not changed.'
    }
    $filter = Get-NetFirewallPortFilter -AssociatedNetFirewallRule $Rule -ErrorAction Stop
    $application = Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $Rule -ErrorAction Stop
    $ports = @($filter.LocalPort)
    if ([string]$filter.Protocol -notin @('TCP', '6') -or $ports.Count -ne 1 -or [string]$ports[0] -ne [string]$GatewayPort -or
        [string]$application.Program -ine $Program) {
        Stop-Setup 'The named rule does not match the configured Node.js program and gateway port; it was not changed.'
    }
}

try {
    if (-not [System.IO.Path]::IsPathRooted($AdminHome)) { Stop-Setup 'AdminHome must be an absolute installed admin directory.' }
    $adminRoot = [System.IO.Path]::GetFullPath($AdminHome).TrimEnd('\')
    $documents = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::MyDocuments)
    $workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $documents 'Codex')).TrimEnd('\')
    if (-not $adminRoot.StartsWith($workspaceRoot + '\', [System.StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path $adminRoot -Leaf) -ine 'AI-WQS-admin' -or
        (Split-Path (Split-Path $adminRoot -Parent) -Leaf) -ine 'outputs') {
        Stop-Setup 'AdminHome must be the installed outputs/AI-WQS-admin directory under the current user Documents/Codex folder.'
    }
    if (-not (Test-Path -LiteralPath $adminRoot -PathType Container)) { Stop-Setup 'The installed admin directory does not exist.' }
    $cursor = Get-Item -LiteralPath $adminRoot -Force
    while ($cursor.FullName.StartsWith($workspaceRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        if (($cursor.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or
            $cursor.Name -in @('releases', 'integrated') -or
            (Test-Path -LiteralPath (Join-Path $cursor.FullName '.git'))) {
            Stop-Setup 'A Git checkout, immutable release directory or reparse point cannot be used as the installed admin home.'
        }
        if ($cursor.FullName -ieq $workspaceRoot) { break }
        $cursor = $cursor.Parent
        if ($null -eq $cursor) { Stop-Setup 'The installed directory could not be validated.' }
    }
    $configFile = Get-Item -LiteralPath (Join-Path $adminRoot 'config.json') -Force
    if ($configFile.PSIsContainer -or $configFile.Length -gt 65536 -or
        ($configFile.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        Stop-Setup 'The installed admin config.json is not a regular configuration file.'
    }
    $configuration = Get-Content -LiteralPath $configFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    $websitePortProperty = $configuration.PSObject.Properties['websitePort']
    $portValue = if ($null -eq $websitePortProperty) { 3200 } else { $websitePortProperty.Value }
    if (($portValue -isnot [int] -and $portValue -isnot [long]) -or $portValue -lt 1024 -or $portValue -gt 65535) {
        Stop-Setup 'The installed websitePort is invalid.'
    }
    $gatewayPort = [int]$portValue
    $adminPortProperty = $configuration.PSObject.Properties['port']
    if ($null -eq $adminPortProperty -or $adminPortProperty.Value -eq $gatewayPort) {
        Stop-Setup 'The gateway port must differ from the administration port.'
    }
    if ($PSBoundParameters.ContainsKey('Port') -and $Port -ne $gatewayPort) {
        Stop-Setup 'Port must match the installed websitePort; no browser-selected port is accepted.'
    }
    $nodeProperty = $configuration.PSObject.Properties['node']
    if ($null -eq $nodeProperty -or $nodeProperty.Value -isnot [string] -or -not [System.IO.Path]::IsPathRooted($nodeProperty.Value)) {
        Stop-Setup 'The installed Node.js program must be an absolute path.'
    }
    $configuredNode = [System.IO.Path]::GetFullPath($nodeProperty.Value)
    if ($PSBoundParameters.ContainsKey('NodePath') -and
        (-not [System.IO.Path]::IsPathRooted($NodePath) -or [System.IO.Path]::GetFullPath($NodePath) -ine $configuredNode)) {
        Stop-Setup 'NodePath must match the installed Node.js program; arbitrary programs are not accepted.'
    }
    $nodeFile = Get-Item -LiteralPath $configuredNode -Force
    if ($nodeFile.PSIsContainer -or $nodeFile.Name -ine 'node.exe' -or
        ($nodeFile.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        Stop-Setup 'The configured program must be the installed regular node.exe file.'
    }
    $configuredNode = $nodeFile.FullName
    $existing = @(Read-NamedRule 'PersistentStore')
    if ($existing.Count -gt 1) { Stop-Setup 'Multiple rules use the reserved name; no rule was changed.' }
    if ($existing.Count -eq 0 -and @(Read-NamedRule 'ActiveStore').Count -gt 0) {
        Stop-Setup 'The reserved rule name is managed by another policy; it was not changed.'
    }
    if ($existing.Count -eq 1) { Assert-OwnedRule $existing[0] $configuredNode $gatewayPort }
    if ($Remove) {
        if ($existing.Count -eq 1) { Remove-NetFirewallRule -InputObject $existing[0] -ErrorAction Stop }
        @{ state = 'missing'; removed = ($existing.Count -eq 1); rule = $ruleName; port = $gatewayPort } | ConvertTo-Json -Compress
        exit 0
    }
    if ($existing.Count -eq 1) {
        Set-NetFirewallRule -InputObject $existing[0] -Enabled True -Direction Inbound -Action Allow -Profile Any `
            -Protocol TCP -LocalPort $gatewayPort -Program $configuredNode -LocalAddress Any -RemoteAddress LocalSubnet `
            -EdgeTraversalPolicy Block -ErrorAction Stop | Out-Null
    } else {
        New-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -DisplayName 'AI WQS Local Workbench Gateway' `
            -Group $ruleGroup -Description $ruleDescription -Enabled True -Direction Inbound -Action Allow -Profile Any `
            -Protocol TCP -LocalPort $gatewayPort -Program $configuredNode -LocalAddress Any -RemoteAddress LocalSubnet `
            -EdgeTraversalPolicy Block -ErrorAction Stop | Out-Null
    }
    $effective = @(Read-NamedRule 'ActiveStore')
    if ($effective.Count -ne 1) { Stop-Setup 'The effective firewall rule could not be uniquely verified.' }
    Assert-OwnedRule $effective[0] $configuredNode $gatewayPort
    $scope = Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $effective[0] -ErrorAction Stop
    $remoteScope = @($scope.RemoteAddress)
    if ([string]$effective[0].Enabled -ne 'True' -or [string]$effective[0].Direction -ne 'Inbound' -or
        [string]$effective[0].Action -ne 'Allow' -or [string]$effective[0].Profile -ne 'Any' -or
        $remoteScope.Count -ne 1 -or [string]$remoteScope[0] -ne 'LocalSubnet') {
        Stop-Setup 'The effective rule does not permit the configured gateway only from LocalSubnet.'
    }
    # No elevated writes to user-selected paths. The caller can refresh the read-only firewall status.
    @{ state = 'allowed'; rule = $ruleName; port = $gatewayPort; scope = 'LocalSubnet' } | ConvertTo-Json -Compress
    exit 0
} catch {
    @{ state = 'error'; message = $script:safeFailure } | ConvertTo-Json -Compress
    exit 1
}
