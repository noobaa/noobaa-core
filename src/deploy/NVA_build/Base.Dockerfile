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
RUN npm run build:native

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
