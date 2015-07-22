FROM ubuntu:trusty
RUN mkdir -p /noobaa /var/log/supervisor /var/run/sshd
#put sshd and noobaa agent under supervision (will start automatically in case of failure, etc)
ADD supervisord.conf /etc/supervisor/conf.d/supervisord.conf
RUN apt-get -y update && apt-get -y install curl git build-essential libssl-dev ssh supervisor
RUN echo "#!/bin/bash" >> /noobaa/install-agent.sh
RUN echo "cd /noobaa" >> /noobaa/install-agent.sh
RUN echo "curl -u tamireran:0436dd1acfaf9cd247b3dd22a37f561f -L http://146.148.16.59:8080/job/LinuxBuild/lastBuild/artifact/build/linux/noobaa-setup >/
tmp/noobaa-setup" >> /noobaa/install-agent.sh
RUN echo "sudo chmod +x /tmp/noobaa-setup" >> /noobaa/install-agent.sh
RUN echo "/tmp/noobaa-setup /S /config <config>> /noobaa
/install-agent.sh
RUN echo ""
RUN chmod +x /noobaa/install-agent.sh
RUN /noobaa/install-agent.sh
ADD init.sh /noobaa/init.sh
RUN chmod +x /noobaa/init.sh
# very bad workaround for a problem that happens randomly on part of the instances.
# adding noobaa user with password noobaa for SSH
RUN ln -s -f /bin/true /usr/bin/chfn
RUN adduser noobaa --disabled-password --gecos ''
RUN adduser noobaa sudo
RUN echo 'noobaa:noobaa' | chpasswd
RUN echo 'AllowGroups sudo' >>/etc/ssh/sshd_config
ENTRYPOINT ["/noobaa/init.sh"]
CMD ["eran","5050"]
