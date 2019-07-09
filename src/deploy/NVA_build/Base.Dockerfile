FROM noobaa-builder

######################################################################
# Layers:
#   Title: npm install (using package.json)
#   Size: ~ 805 MB
#   Cache: Rebuild when there is new package.json or package-lock.json
######################################################################
COPY ./package*.json ./
RUN source /opt/rh/devtoolset-7/enable && \
    npm install 

##############################################################
# Layers:
#   Title: Building the native code
#   Size: ~ 10 MB
#   Cache: Rebuild when Node.js there a change in the native 
#          directory or in the binding.gyp
##############################################################
COPY ./binding.gyp .
COPY ./src/native ./src/native/
RUN source /opt/rh/devtoolset-7/enable && \
    npm run build:native

######################################################################
# Layers:
#   Title: npm install the frontend
#   Size: ~ 116 MB
#   Cache: Rebuild when there is new package.json or package-lock.json 
######################################################################
COPY ./frontend/package*.json ./frontend/
RUN cd frontend && \
    npm install

##############################################################
# Layers:
#   Title: installing bower packages for the frontend
#   Size: ~ 49.7 MB
#   Cache: Rebuild when there is new gulpfile or bower.json
##############################################################
COPY ./frontend/gulpfile.js ./frontend/
COPY ./frontend/bower.json ./frontend/
RUN cd frontend && \
    npm run install-deps

##############################################################
# Layers:
#   Title: Copying the code and Building the frontend
#   Size: ~ 131 MB
#   Cache: Rebuild when changing any file which is copied
##############################################################
COPY ./frontend/ ./frontend/
COPY ./images/ ./images/
COPY ./src/rpc/ ./src/rpc/
COPY ./src/api/ ./src/api/
COPY ./src/util/ ./src/util/
COPY ./config.js ./
RUN source /opt/rh/devtoolset-7/enable && \
    npm run build:fe
