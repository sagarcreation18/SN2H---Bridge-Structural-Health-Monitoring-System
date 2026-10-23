$ErrorActionPreference = 'Stop'
$mysqlBin = 'C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe'
$databasePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '.runtime\mysql'))
if (-not (Test-Path -LiteralPath $databasePath)) { throw 'Local database not initialized. See README.md for standard MySQL setup.' }
if (Get-NetTCPConnection -LocalPort 3307 -State Listen -ErrorAction SilentlyContinue) { Write-Host 'Port 3307 already has a listener. Verify this is your local MySQL instance.'; exit 0 }
Start-Process -FilePath $mysqlBin -ArgumentList @('--no-defaults',('--datadir="' + $databasePath + '"'),'--port=3307','--bind-address=127.0.0.1','--mysqlx=OFF','--innodb-redo-log-capacity=16777216') -WindowStyle Hidden
Write-Host 'Local MySQL starting on 127.0.0.1:3307. Wait a few seconds before starting the app.'
