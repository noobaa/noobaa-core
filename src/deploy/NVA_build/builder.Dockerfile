FROM centos:7 
LABEL maintainer="Liran Mauda (lmauda@redhat.com)"

##############################################################
# Layers:
#   Title: installing pre requirments
#   Size: ~ 613 MB
#   Cache: rebuild when we adding/removing requirments
##############################################################
ENV container docker
RUN yum install -y -q wget unzip which vim centos-release-scl && \
    yum group install -y -q "Development Tools" && \ 
    yum install -y -q devtoolset-7 && \
    yum clean all
RUN source /opt/rh/devtoolset-7/enable && \
    version="1.3.0" && \
    wget -q http://www.tortall.net/projects/yasm/releases/yasm-${version}.tar.gz && \
    tar xf yasm-${version}.tar.gz && \
    pushd yasm-${version} && \
    ./configure && \
    make && \
    make install && \
    popd && \
    rm -rf yasm-${version} yasm-${version}.tar.gz

##############################################################
# Layers:
#   Title: Node.js install with nvm
#   Size: ~ 61 MB
#   Cache: rebuild when Node.js version change in .nvmrc
#
# In order to build this we should run 
# docker build from the local repo 
##############################################################
COPY ./.nvmrc ./noobaa-core/.nvmrc
RUN export PATH=$PATH:/usr/local/bin && \
    cd /usr/src && \
    curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.31.6/install.sh | bash && \
    export NVM_DIR="/root/.nvm" && \
    source /root/.nvm/nvm.sh && \
    NODE_VER=$(cat /noobaa-core/.nvmrc) && \
    nvm install ${NODE_VER} && \
    nvm alias default $(nvm current) && \
    cd ~ && \
    ln -sf $(which node) /usr/local/bin/node && \
    ln -sf $(which npm) /usr/local/bin/npm && \
    npm config set unsafe-perm true && \
    echo '{ "allow_root": true }' > /root/.bowerrc

RUN mkdir -p /noobaa/src/
WORKDIR /noobaa
