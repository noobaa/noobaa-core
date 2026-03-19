#!/bin/bash
set -euo pipefail
CENTOS_VER=${CENTOS_VER:-9}
RPM_URL="https://developer.download.nvidia.com/compute/cuobjserver/1.0.0/local_installers/cuobjserver-local-repo-rhel${CENTOS_VER}-1.0.0-1.0.0-1.x86_64.rpm"
echo "Installing CUOBJ server rpm"
curl -L -o cuobjserver.rpm "$RPM_URL"
rpm -i cuobjserver.rpm
dnf clean all
dnf -y install cuobjserver rdma-core-devel
