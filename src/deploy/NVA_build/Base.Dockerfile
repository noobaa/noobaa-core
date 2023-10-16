FROM noobaa-builder

######################################################################
# Layers:
#   Title: npm install (using package.json)
#   Size: ~ 805 MB
#   Cache: Rebuild when there is new package.json or package-lock.json
######################################################################
COPY ./package*.json ./
RUN npm install --production && \
    npm cache clean --force

##############################################################
# Layers:
#   Title: Building the native code
#   Size: ~ 10 MB
#   Cache: Rebuild when Node.js there a change in the native 
#          directory or in the binding.gyp
##############################################################
COPY ./binding.gyp .
COPY ./src/native ./src/native/
COPY ./src/deploy/nsfs.service ./src/deploy/
COPY ./src/deploy/nsfs_env.env ./src/deploy/
COPY ./src/deploy/NVA_build/clone_submodule.sh ./src/deploy/NVA_build/
COPY ./src/deploy/NVA_build/clone_s3select_submodules.sh ./src/deploy/NVA_build/
ARG BUILD_S3SELECT=1
ARG BUILD_S3SELECT_PARQUET=0
#Clone S3Select and its two submodules, but only if BUILD_S3SELECT=1.
RUN ./src/deploy/NVA_build/clone_s3select_submodules.sh
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
