# This runs the upgrade in a separate session in order to make sure it doesn't die

setsid /usr/local/noobaa/noobaa-setup >& /dev/null &
