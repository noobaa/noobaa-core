# Last stage exports just the executable from the image built on previous stage.
# Expects to be used with `--output` flag of `docker build` or `podman build`.
# see https://docs.docker.com/engine/reference/commandline/build/#output
# or https://docs.podman.io/en/latest/markdown/podman-build.1.html#output-o-output-opts
FROM noobaa-core-executable as noobaa-core-executable
FROM scratch AS export-stage
ARG OS=linux
ARG PLATFORM=x86_64
ARG GIT_COMMIT
COPY --from=noobaa-core-executable /noobaa/build/noobaa-core ./noobaa-core-${OS}-${PLATFORM}-${GIT_COMMIT}
