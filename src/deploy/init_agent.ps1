[Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}
$TARGETDIR = "c:\noobaa"
$dpscript = @"
select volume=c
extend
"@
if(!(Test-Path -Path $TARGETDIR )){
    New-Item -ItemType directory -Path $TARGETDIR
    cd -Path $TARGETDIR
    $args
    $dpscript | diskpart
    netsh advfirewall set allprofiles state off
    $env_name = $args[0]
    $setup_link = "https://"+$env_name+":8443/public/noobaa-setup.exe"
    $setup_link
    $wc = New-Object System.Net.WebClient
    $wc.DownloadFile($setup_link,"c:\noobaa\noobaa-setup.exe")
    $agent_conf= $args[1]
    Start-Sleep -s 30
    c:\noobaa\noobaa-setup.exe /S /config $agent_conf
} else {
    $agent_conf= $args[1]
    c:\noobaa\noobaa-setup.exe /S /config $agent_conf
}
