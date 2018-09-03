FROM centos:7

#################
# INSTALLATIONS #
#################

RUN yum -y update
RUN yum -y install centos-release-scl
RUN yum -y install openssl
RUN yum -y install devtoolset-7

RUN yum -y remove epel-release
RUN yum -y --enablerepo=extras install epel-release
RUN yum -y install yasm

# nvm - for all users
# adding nvm.sh to /etc/profile.d/nvm.sh to be loaded by any non-interactive shells
ENV NVM_DIR /nvm
RUN touch /etc/profile.d/nvm.sh && \
    curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.33.6/install.sh | PROFILE=/etc/profile.d/nvm.sh bash

# ADD http://www.tortall.net/projects/yasm/releases/yasm-1.3.0.tar.gz .
# RUN tar xf yasm-1.3.0.tar.gz && pushd yasm-1.3.0 && ./configure && make && make install && popd && rm -rf yasm-1.3.0 yasm-1.3.0.tar.gz

##############
# BASH SETUP #
##############

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
# NOOBAA SETUP #
################

RUN mkdir -p /usr/local/noobaa
WORKDIR /usr/local/noobaa

COPY src/s3/ ./src/s3/
COPY src/sdk/ ./src/sdk/
COPY src/endpoint/ ./src/endpoint/
COPY src/agent/ ./src/agent/
COPY src/rpc/ ./src/rpc/
COPY src/api/ ./src/api/
COPY src/util/ ./src/util/
COPY src/tools/ ./src/tools/
COPY src/native/ ./src/native/
COPY LICENSE .
COPY config.js .
COPY binding.gyp .
COPY package.json .

# remove irrelevant packages
RUN sed -i '/gulp/d' package.json
RUN sed -i '/mocha/d' package.json
RUN sed -i '/istanbul/d' package.json
RUN sed -i '/eslint/d' package.json
RUN sed -i '/vsphere/d' package.json

RUN scl enable devtoolset-7 "npm install --production"

RUN rm -rf agent_conf.json src/native

COPY src/deploy/NVA_build/run_agent_container.sh .
RUN chmod +x run_container.sh
EXPOSE 60101-60600
ENTRYPOINT ["./run_agent_container.sh"]