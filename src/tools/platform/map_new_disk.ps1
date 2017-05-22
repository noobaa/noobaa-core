#first we find and initialize physical disks with no partitions 
$drives = gwmi Win32_diskdrive
$scriptdisk = $Null
$script = $Null
foreach ($disk in $drives){
    if ($disk.Partitions -eq "0"){
        $drivenumber = $disk.DeviceID -replace '[\\\\\.\\physicaldrive]',''        
$script = @"
select disk $drivenumber
online disk noerr
attributes disk clear readonly noerr
create partition primary noerr
format quick
"@
}
$drivenumber = $Null
$scriptdisk += $script + "`n"
}
$scriptdisk | diskpart

#then we will move the CDRom drive to x:
(gwmi Win32_cdromdrive).drive | %{$a = mountvol $_ /l;mountvol $_ /d;$a = $a.Trim();mountvol x: $a}

#then we will assign letters and labels to physical drives
# thanks to powershell.com for this bit
#(http://powershell.com/cs/blogs/tips/archive/2009/01/15/enumerating-drive-letters.aspx)
$volumes = gwmi Win32_volume | where {$_.BootVolume -ne $True -and $_.SystemVolume -ne $True -and $_.DriveType -eq "3"}
$letters = 68..89 | ForEach-Object { ([char]$_)+":" }
$freeletters = $letters | Where-Object { 
  (New-Object System.IO.DriveInfo($_)).DriveType -eq 'NoRootDirectory'
}
foreach ($volume in $volumes){
    if ($volume.DriveLetter -eq $Null){
        mountvol $freeletters[0] $volume.DeviceID
    }
$freeletters = $letters | Where-Object { 
    (New-Object System.IO.DriveInfo($_)).DriveType -eq 'NoRootDirectory'
}
} 