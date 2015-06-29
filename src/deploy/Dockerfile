
FROM ubuntu:trusty
RUN mkdir -p /noobaa /var/log/supervisor /var/run/sshd

#put sshd and noobaa agent under supervision (will start automatically in case of failure, etc)
ADD supervisord.conf /etc/supervisor/conf.d/supervisord.conf
RUN apt-get -y update && apt-get -y install curl git build-essential libssl-dev ssh supervisor

# install nodejs with nvm (node version manager)

RUN echo "#!/bin/bash" >> /noobaa/install_nvm.sh
RUN echo 'export NVM_DIR="/usr/local/nvm"' >> /noobaa/install_nvm.sh
RUN echo 'curl https://raw.githubusercontent.com/creationix/nvm/v0.20.0/install.sh | NVM_DIR="$NVM_DIR" PROFILE="/etc/profile" bash'>> /noobaa/install_nvm.sh
RUN echo "source /usr/local/nvm/nvm.sh && nvm install 0.10.33 && nvm alias default 0.10.33 && nvm current" >> /noobaa/install_nvm.sh
RUN chmod +x /noobaa/install_nvm.sh &&  /noobaa/install_nvm.sh
RUN echo "#!/bin/bash" >> /noobaa/install-agent.sh
RUN echo "cd /noobaa" >> /noobaa/install-agent.sh
RUN echo "source /usr/local/nvm/nvm.sh" >> /noobaa/install-agent.sh
RUN echo "nvm use 0.10.33" >> /noobaa/install-agent.sh

# <ENV_PLACEHOLDER> replaced by docker_setup.sh with metadata variable (set by the gcloud.js)

RUN echo 'time curl -k -H "Accept: application/json" https://<ENV_PLACEHOLDER>:8443/agent/package.json > package.json' >> /noobaa/install-agent.sh
RUN echo "time rm -rf node_modules/" >> /noobaa/install-agent.sh
RUN echo "time npm config set strict-ssl false" >> /noobaa/install-agent.sh
RUN echo "time npm install" >> /noobaa/install-agent.sh
RUN chmod +x /noobaa/install-agent.sh
ADD run-agent.sh /noobaa/run-agent.sh
RUN /noobaa/install-agent.sh

# CMD rm -f /noobaa/node_modules/noobaa-agent/agent/agent_cli.js
# ADD agent_cli.js /noobaa/node_modules/noobaa-agent/agent/agent_cli.js
# ADD agent_cli.js /noobaa/agent_cli.js
RUN chmod +x /noobaa/run-agent.sh

ADD init.sh /noobaa/init.sh
RUN chmod +x /noobaa/init.sh
ADD agent_conf.json /noobaa/agent_conf.json

# very bad workaround for a problem that happens randomly on part of the instances.
# adding noobaa user with password noobaa for SSH
RUN ln -s -f /bin/true /usr/bin/chfn
RUN adduser noobaa --disabled-password --gecos ''
RUN adduser noobaa sudo
RUN echo 'noobaa:noobaa' | chpasswd
RUN echo 'AllowGroups sudo' >>/etc/ssh/sshd_config
ENTRYPOINT ["/noobaa/init.sh"]
CMD ["eran","5050"]
