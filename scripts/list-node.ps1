$output = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object { [string]$_.ProcessId + ' :: ' + $_.CommandLine }
if ($output) { $output } else { 'no node.exe processes found' }
