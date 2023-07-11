# This dockerfile exports just the single file executable from the built image.
# It uses a multi-stage to pick just one file which would then be exported with:
#   docker build --output ...
# see https://docs.docker.com/engine/reference/commandline/build/#output
# or https://docs.podman.io/en/latest/markdown/podman-build.1.html#output-o-output-opts
FROM noobaa-core-executable as noobaa-core-executable
FROM scratch AS export-stage
ARG OS=linux
ARG PLATFORM=x86_64
ARG GIT_COMMIT
COPY --from=noobaa-core-executable /noobaa/build/noobaa-core ./noobaa-core-${OS}-${PLATFORM}-${GIT_COMMIT}
