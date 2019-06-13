FROM noobaa/builder as base

##############################################################
# Layers:
#   Title: getting the node 
#   Size: ~ 110 MB
#   Cache: rebuild the .nvmrc  is canging
##############################################################
COPY ./.nvmrc ./.nvmrc
RUN NODEJS_VERSION=v$(cat ./.nvmrc) && \
    FILE_NAME=node-${NODEJS_VERSION}-linux-x64.tar.xz && \
    cd / && \
    curl https://nodejs.org/dist/${NODEJS_VERSION}/${FILE_NAME} > ${FILE_NAME} && \
    tar -xf ${FILE_NAME} && \
    mkdir -p /node_bin/ && \
    cp /node-${NODEJS_VERSION}-linux-x64/bin/node /node_bin/ 

##############################################################
# Layers:
#   Title: installing dependencies (npm install)
#   Size: ~ 667 MB
#   Cache: rebuild when we package.json changes
##############################################################
COPY ./package*.json ./
COPY src/deploy/NVA_build/fix_package_json.sh ./

# remove irrelevant packages
RUN sed -i '/babel/d' package.json && \
    sed -i '/gulp/d' package.json && \
    sed -i '/mocha/d' package.json && \
    sed -i '/nyc/d' package.json && \
    sed -i '/istanbul/d' package.json && \
    sed -i '/eslint/d' package.json && \
    sed -i '/phantomjs/d' package.json && \
    sed -i '/selenium/d' package.json && \
    sed -i '/vsphere/d' package.json  && \ 
    ./fix_package_json.sh

RUN npm install --production && \
    npm install node-linux@0.1.8

##############################################################
# Layers:
#   Title: Building the native
#   Size: ~ 10 MB
#   Cache: rebuild the native code changes
##############################################################
COPY ./binding.gyp .
COPY ./src/native ./src/native/
RUN npm run build:native


ARG GIT_COMMIT 
RUN if [ "${GIT_COMMIT}" != "" ]; then sed -i 's/^  "version": "\(.*\)",$/  "version": "\1-'${GIT_COMMIT:0:7}'",/' package.json; fi

COPY . ../noobaa-core/

RUN chmod +x ../noobaa-core/src/deploy/NVA_build/run_agent_container.sh && \
    cp ../noobaa-core/LICENSE . && \
    cp ../noobaa-core/config.js . && \
    cp ../noobaa-core/src/deploy/Linux/noobaa_service_installer.sh . && \
    cp ../noobaa-core/src/deploy/Linux/uninstall_noobaa_agent.sh . && \
    cp ../noobaa-core/src/deploy/Linux/remove_service.sh . && \
    cp -R ../noobaa-core/src/s3 src/ && \
    cp -R ../noobaa-core/src/sdk src/ && \
    cp -R ../noobaa-core/src/endpoint src/ && \
    cp -R ../noobaa-core/src/agent src/ && \
    cp -R ../noobaa-core/src/rpc src/ && \
    cp -R ../noobaa-core/src/api src/ && \
    cp -R ../noobaa-core/src/util src/ && \
    cp -R ../noobaa-core/src/tools src/ && \
    cp -R ../noobaa-core/src/deploy src/ && \
    rm -rf agent_conf.json src/native fix_package_json.sh

#####################################################################################################################################

FROM centos:7 

ENV container docker

##############################################################
# Layers:
#   Title: Installing dependencies
#   Size: ~ 27 MB
#   Cache: rebuild when we adding/removing requirments
##############################################################
RUN yum install -y -q openssl && \
    yum clean all
RUN mkdir -p /noobaa_storage

RUN chgrp 0 /etc/passwd && chmod -R g=u /etc/passwd
##############################################################
# Layers:
#   Title: copy node
#   Size: ~ 39 MB
#   Cache: rebuild when there is new base 
##############################################################
COPY --from=base /node_bin/ /bin/
COPY --from=base /noobaa/build/Release/kube_pv_chown ./bin/
RUN chown root:root ./bin/kube_pv_chown && \
    chmod 755 ./bin/kube_pv_chown && \
    chmod u+s ./bin/kube_pv_chown

##############################################################
# Layers:
#   Title: copy noobaa
#   Size: ~ 575 MB
#   Cache: rebuild when there is new base 
##############################################################
COPY --from=base /noobaa/ /usr/local/noobaa/
WORKDIR /usr/local/noobaa

###############
# PORTS SETUP #
###############
EXPOSE 60101-60600

###############
# EXEC SETUP #
###############
# run as non root user that belongs to root group
USER 10001:0
ENTRYPOINT ["./src/deploy/NVA_build/run_agent_container.sh"]
