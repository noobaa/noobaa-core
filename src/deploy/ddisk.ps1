[Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}
$agent_conf=$args[1]
$env_name=$args[0]
& 'C:\Program Files\NooBaa\uninstall-noobaa.exe' /S
$Disks = Get-WmiObject Win32_DiskDrive | where {$_.partitions -eq 0}
foreach ($disk in $Disks)
{
    $diskID = $disk.index
    echo "Adding disk $disk.DeviceID"
    $dpscript = @"
      select disk $diskID
      convert gpt
      create partition primary
      automount enable
      format fs=ntfs quick
      assign
"@
    $dpscript | diskpart
}
$setup_link = "https://"+$env_name+":8443/public/noobaa-setup.exe"
$wc = New-Object System.Net.WebClient
$wc.DownloadFile($setup_link,"c:\noobaa\noobaa-setup.exe")
$agent_conf= $args[1]
c:\noobaa\noobaa-setup.exe /S /config $agent_conf
