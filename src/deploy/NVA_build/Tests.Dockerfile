FROM centos:7 as base
LABEL maintainer="Liran Mauda (lmauda@redhat.com)"

##############################################################
# Layers:
#   Title: installing pre requirments
#   Size: ~ 377 MB
#   Cache: rebuild when we adding/removing requirments
##############################################################
ENV container docker
RUN yum install -y -q wget unzip which vim && \
    yum group install -y -q "Development Tools" && \ 
    yum clean all
RUN version="1.3.0" && \
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
    ln -sf $(which npm) /usr/local/bin/npm
WORKDIR /noobaa-core/

#####################################################################
# Layers:
#   Title: npm install (using package.json)
#   Size: ~ 825 MB
#   Cache: rebuild when ther is new package.json or package-lock.json
#####################################################################
COPY ./package*.json ./
RUN npm install
RUN echo 'PATH=$PATH:/noobaa-core/node_modules/.bin' >> ~/.bashrc

##############################################################
# Layers:
#   Title: Building the native code
#   Size: ~ 10 MB
#   Cache: rebuild when Node.js there a change in the native 
#          directory or in the binding.gyp
##############################################################
COPY ./binding.gyp .
COPY ./src/native ./src/native/
RUN npm run build:native

##############################################################
# Layers:
#   Title: Building the frontend
#   Size: ~ 18 MB
#   Cache: rebuild when there a change in the frontend directory 
#
##############################################################
COPY ./frontend/ ./frontend/
COPY ./src/tools/npm_install.js ./src/tools/
RUN npm run build:fe

##############################################################
# Layers:
#   Title: Building the frontend
#   Size: ~ 139 MB 
#   Cache: rebuild when tchanging any file 
#          which is not excluded by .dockerignore 
##############################################################
COPY . ./

FROM base as unitest

##############################################################
# Layers:
#   Title: installing unitest pre requirments
#   Size: ~ 262 MB
#   Cache: rebuild when we adding/removing requirments
##############################################################
ENV TEST_CONTAINER true
RUN yum install -y -q centos-release-scl && \
    yum install -y -q rh-mongodb36 && \
    yum install -y ntpdate && \ 
    yum clean all

##############################################################
# Layers:
#   Title: Setting some test env variables
#   Size: ~ 1 MB
#   Cache: rebuild when using the --build-arg flag
#
# Setting cloud cradentials for the tests
# In order to set those we need to run build with 
# --build-arg <arg_name>="<value>"
##############################################################

ARG aws_access_key_arg 
ARG aws_secret_access_key_arg
ARG azure_storage_arg
ARG test_name_arg
RUN mkdir -p /data/ && \
    echo 'ENDPOINT_BLOB_ENABLED=true' >> /data/.env && \
    echo 'DEV_MODE=true' >> /data/.env && \
    echo "TEST_RUN_NAME=$test_name_arg" >> /data/.env && \
    echo "AWS_ACCESS_KEY_ID=$aws_access_key_arg" >> /data/.env && \
    echo "AWS_SECRET_ACCESS_KEY=$aws_secret_access_key_arg" >> /data/.env && \
    echo "AZURE_STORAGE_CONNECTION_STRING=$azure_storage_arg" >> /data/.env 

CMD ["/bin/bash", "-c", "src/test/unit_tests/run_npm_test_on_test_container.sh"]
