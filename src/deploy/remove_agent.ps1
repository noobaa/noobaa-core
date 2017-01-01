& 'C:\Program Files\NooBaa\uninstall-noobaa.exe' /S
if(Test-Path -Path 'C:\Program Files\NooBaa'){
	Write-Error (“NooBaa directory still exist!”)
}
