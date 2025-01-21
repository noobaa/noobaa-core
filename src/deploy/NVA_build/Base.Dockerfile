FROM noobaa-builder AS noobaa-base

######################################################################
# Layers:
#   Title: npm install (using package.json)
#   Size: ~ 805 MB
#   Cache: Rebuild when there is new package.json or package-lock.json
######################################################################
COPY ./package*.json ./
RUN npm install --omit=dev && \
    npm cache clean --force
RUN rm -rf node_modules/node-rdkafka/deps/librdkafka/examples/
RUN rm -rf node_modules/node-rdkafka/deps/librdkafka/src/

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
ARG BUILD_S3SELECT=1
ARG BUILD_S3SELECT_PARQUET=0
#Clone S3Select and its two submodules, but only if BUILD_S3SELECT=1.
RUN ./src/deploy/NVA_build/clone_s3select_submodules.sh
RUN ln -s /lib64/libboost_thread.so.1.66.0 /lib64/libboost_thread.so.1.75.0 || true
#Pass BUILD_S3SELECT down to GYP native build.
#S3Select will be built only if this parameter is equal to "1".
RUN GYP_DEFINES="BUILD_S3SELECT=$BUILD_S3SELECT BUILD_S3SELECT_PARQUET=$BUILD_S3SELECT_PARQUET" npm run build

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
