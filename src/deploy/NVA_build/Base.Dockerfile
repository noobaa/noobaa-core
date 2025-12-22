FROM noobaa-builder AS noobaa-base

# By default we build the image with rdkafka support, but can be overridden
ARG USE_RDKAFKA=1
# By default we build the image with s3select support, but can be overridden
ARG BUILD_S3SELECT=1
ARG GYP_DEFINES

######################################################################
# Layers:
#   Title: npm install (using package.json)
#   Size: ~ 805 MB
#   Cache: Rebuild when there is new package.json or package-lock.json
######################################################################
COPY ./package*.json ./
RUN npm install --omit=dev && \
    npm cache clean --force && \
    rm -rf node_modules/node-rdkafka/deps/librdkafka/examples/ && \
    rm -rf node_modules/node-rdkafka/deps/librdkafka/src/

# Build time check that rdkafka was installed by npm in the image.
# It was added to optionalDependencies because it's not available 
# on all platforms, so we check explicitly.
RUN if [ "$USE_RDKAFKA" = "1" ]; then \
        node -p 'require("node-rdkafka").librdkafkaVersion'; \
    fi

##############################################################
# Layers:
#   Title: Building the native code
#   Size: ~ 10 MB
#   Cache: Rebuild when Node.js there a change in the native 
#          directory or in the binding.gyp
##############################################################
COPY ./binding.gyp .
COPY ./src/native ./src/native/
COPY ./src/deploy/noobaa.service ./src/deploy/
COPY ./src/deploy/nsfs_env.env ./src/deploy/
COPY ./src/deploy/NVA_build/clone_submodule.sh ./src/deploy/NVA_build/
COPY ./src/deploy/NVA_build/clone_s3select_submodules.sh ./src/deploy/NVA_build/

#Clone S3Select and its two submodules, but only if BUILD_S3SELECT=1.
RUN if [ "$BUILD_S3SELECT" = "1" ]; then ./src/deploy/NVA_build/clone_s3select_submodules.sh; fi
RUN ln -s /lib64/libboost_thread.so.1.66.0 /lib64/libboost_thread.so.1.75.0 || true
RUN npm run build

##############################################################
# Layers:
#   Title: Copying the code
#   Size: ~ 131 MB
#   Cache: Rebuild when changing any file which is copied
##############################################################
COPY ./images/ ./images/
COPY ./src/rpc/ ./src/rpc/
COPY ./src/api/ ./src/api/
COPY ./src/util/ ./src/util/
COPY ./config.js ./
