FROM noobaa/builder as base

##############################################################
# Layers:
#   Title: Installing dependencies (npm install)
#   Size: ~ 667 MB
#   Cache: Rebuild when we package.json changes
##############################################################
COPY ./package*.json ./
COPY src/deploy/NVA_build/fix_package_json.sh ./

# Remove irrelevant packages
RUN sed -i '/babel/d' package.json && \
    sed -i '/mocha/d' package.json && \
    sed -i '/nyc/d' package.json && \
    sed -i '/istanbul/d' package.json && \
    sed -i '/eslint/d' package.json && \
    sed -i '/phantomjs/d' package.json && \
    sed -i '/selenium/d' package.json && \
    sed -i '/vsphere/d' package.json  && \ 
    ./fix_package_json.sh

RUN npm install --production

##############################################################
# Layers:
#   Title: Building the native
#   Size: ~ 10 MB
#   Cache: Rebuild the native code changes
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
#   Cache: Rebuild when we adding/removing requirments
##############################################################
RUN yum install -y -q openssl && \
    yum clean all
RUN mkdir -p /noobaa_storage

RUN chgrp 0 /etc/passwd && chmod -R g=u /etc/passwd
##############################################################
# Layers:
#   Title: Copy node
#   Size: ~ 39 MB
#   Cache: Rebuild when there is new base 
##############################################################
COPY --from=base /usr/local/bin/node /bin/
COPY --from=base /noobaa/build/Release/kube_pv_chown ./bin/
RUN chown root:root ./bin/kube_pv_chown && \
    chmod 750 ./bin/kube_pv_chown && \
    chmod u+s ./bin/kube_pv_chown

##############################################################
# Layers:
#   Title: Copy noobaa
#   Size: ~ 575 MB
#   Cache: Rebuild when there is new base 
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
# Run as non root user that belongs to root group
USER 10001:0
ENTRYPOINT ["./src/deploy/NVA_build/run_agent_container.sh"]
