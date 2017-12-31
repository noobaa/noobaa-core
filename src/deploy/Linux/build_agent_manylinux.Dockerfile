FROM centos:6

#################
# INSTALLATIONS #
#################

# best keep installations first for best docker images caching
RUN yum -y update
RUN yum -y install centos-release-scl
RUN yum -y install devtoolset-7

# nvm - for all users
# adding nvm.sh to /etc/profile.d/nvm.sh to be loaded by any non-interactive shells
ENV NVM_DIR /nvm
RUN touch /etc/profile.d/nvm.sh && \
    curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.33.6/install.sh | PROFILE=/etc/profile.d/nvm.sh bash

ADD http://www.tortall.net/projects/yasm/releases/yasm-1.3.0.tar.gz .
RUN tar xf yasm-1.3.0.tar.gz && pushd yasm-1.3.0 && ./configure && make && make install && popd && rm -rf yasm-1.3.0 yasm-1.3.0.tar.gz


##############
# BASH SETUP #
##############

# 1. non-interactive shell        => setting BASH_ENV to make bash load /etc/profile too
# 2. interactive login shell      => bash loads /etc/profile + ~/.bash_profile|~/.bash_login|~/.profile
# 3. interactive non-login shell  => ~/.bashrc
# 4. remote shell daemon (ssh)    => ~/.bashrc
# (refere to https://www.gnu.org/software/bash/manual/html_node/Bash-Startup-Files.html)

SHELL [ "/bin/bash", "-c" ]
ENV BASH_ENV '/etc/profile'
RUN echo '. /etc/profile' >> ~/.bashrc


#################
# NODE.JS SETUP #
#################

# install current node.js version
COPY .nvmrc .
RUN nvm install

# configure npm
# unsafe-perm is needed in order to run by root
RUN npm config set unsafe-perm true


################
# DOCKER SETUP #
################

COPY src/deploy/Linux/build_agent_manylinux_entrypoint.sh /tmp/build_agent_manylinux_entrypoint.sh
ENTRYPOINT [ "/tmp/build_agent_manylinux_entrypoint.sh" ]
WORKDIR /work