function FuncCheckService{
 param($ServiceName)
 $arrService = Get-Service -Name $ServiceName
 if ($arrService.Status -ne "Running"){
 Start-Service $ServiceName
 Write-Host "$(date) Starting " $ServiceName " service" 
 "$(date) ---------------------- " 
 "$(date) Service is now started"
 }
 if ($arrService.Status -eq "running"){ 
 Write-Host "$(date) $ServiceName service is already started"
 }
 }


 while ($true) {
    FuncCheckService jenkinsslave-c__jenkins
    sleep 300
 }
 