#!/bin/bash
#!/bin/bash
PATH=/usr/local/noobaa:$PATH;
/usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_uninstaller
sleep 10
/usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer

if [[ $(ps -elf|grep 'systemd+\{0,1\}[ ]\{1,\}[0-9]\{1,\}[ ]\{1,\}1 ') ]]; then
  systemctl enable noobaalocalservice
else
  #upstart equivilant
fi
