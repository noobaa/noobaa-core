# This runs the upgrade in a separate session in order to make sure it doesn't die

mkdir -p /usr/local/noobaa/logs &> /dev/null
setsid /usr/local/noobaa/noobaa-setup >> /usr/local/noobaa/logs/upgrade.log 2>&1
