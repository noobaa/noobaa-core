copy 'C:\Program Files\NooBaa\package.json' 'C:\Program Files\NooBaa\package.json.backup'
$packageJson = Get-Content 'C:\Program Files\NooBaa\package.json' 
$ver = $packageJson | Select-String -Pattern version 
$packageJson -replace "$ver", '"version": "test",' | Set-Content 'C:\Program Files\NooBaa\package.json'
Stop-Process -processname node -Force
