[Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}
$TARGETDIR = "c:\noobaa"
if(!(Test-Path -Path $TARGETDIR )){
    New-Item -ItemType directory -Path $TARGETDIR
    cd -Path $TARGETDIR
    $args
    $MaxSize = (Get-PartitionSupportedSize -DriveLetter c).sizeMax
    Resize-Partition -DriveLetter c -Size $MaxSize
    Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled False
    $env_name = $args[0]
    $setup_link = "https://"+$env_name+":8443/public/noobaa-setup.exe"
    $setup_link
    $wc = New-Object System.Net.WebClient
    $wc.DownloadFile($setup_link,"c:\noobaa\noobaa-setup.exe")
    $agent_conf= $args[1]
    c:\noobaa\noobaa-setup.exe /S /config $agent_conf
}
