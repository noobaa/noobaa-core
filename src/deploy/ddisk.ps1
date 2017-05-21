[Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}
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
