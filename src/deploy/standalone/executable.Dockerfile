# This dockerfile starts from the base image which contains all the node-js code
# and native libraries already build, and then it builds a single executable using pkg.
FROM noobaa-base

RUN npm install --include=dev && ./node_modules/.bin/pkg-fetch -n node18

ARG GIT_COMMIT 
RUN if [ "${GIT_COMMIT}" != "" ]; then \
        sed -i 's/^  "version": "\(.*\)",$/  "version": "\1-'${GIT_COMMIT:0:7}'",/' package.json; \
    fi

COPY src ./src
COPY config.js ./config.js
COPY platform_restrictions.json ./platform_restrictions.json
RUN npm run pkg

ENTRYPOINT [ "/noobaa/build/noobaa-core" ]
