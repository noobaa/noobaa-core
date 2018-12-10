#!/bin/bash
podman build -f ./src/deploy/NVA_build/Server.Dockerfile -t nbimage --rm ./ || exit 1
