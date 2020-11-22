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

######################################################################
# Layers:
#   Title: npm install the frontend
#   Size: ~ 116 MB
#   Cache: Rebuild when there is new package.json or package-lock.json 
######################################################################
COPY ./frontend/package*.json ./frontend/
RUN cd frontend && \
    npm install

######################################################################
# Layers:
#   Title: Copying the code and Building the frontend library
#   Size: ~ 245 MB
#   Cache: Rebuild when changing any file which is copied
######################################################################
COPY ./frontend/ ./frontend/
RUN echo '{ "allow_root": true }' > /root/.bowerrc
RUN cd frontend && \
    npm run build-lib

COPY ./frontend/src/lib/lib* /tmp/
RUN diff ./frontend/src/lib/lib.js /tmp/
RUN diff ./frontend/src/lib/lib.js.map /tmp/
