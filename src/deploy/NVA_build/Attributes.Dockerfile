FROM noobaa-builder as code

#TODO: get the code from git not from the local 
COPY . ./

FROM code as npm_cache

RUN npm run clean && \ 
    npm cache clean --force

COPY ./package*.json ./
RUN npm install

RUN tar -zcf build_deps.tar.gz /root/.npm/ /root/.node-gyp

COPY ./frontend/package*.json ./frontend/
RUN cd frontend && \
    npm install

COPY ./frontend/gulpfile.js ./frontend/
COPY ./frontend/bower.json ./frontend/
RUN cd frontend && \
    npm run install-deps

COPY ./frontend/ ./frontend/
COPY ./images/ ./images/
COPY ./src/rpc/ ./src/rpc/
COPY ./src/api/ ./src/api/
COPY ./src/util/ ./src/util/
COPY ./config.js ./
RUN npm run build:fe

FROM code 

ARG GIT_COMMIT 
RUN if [ "${GIT_COMMIT}" != "" ]; then sed -i 's/^  "version": "\(.*\)",$/  "version": "\1-'${GIT_COMMIT:0:7}'",/' package.json; fi 

COPY --from=npm_cache /noobaa/frontend/dist/ /noobaa/frontend/dist/
RUN name=noobaa.tar.gz && \
    cd / && \
    tar -zcf /tmp/${name} /noobaa && \
    mv /tmp/${name} ./
COPY --from=npm_cache /noobaa/build_deps.tar.gz ./
