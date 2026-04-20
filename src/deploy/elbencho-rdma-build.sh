#!/bin/bash
set -xeuo pipefail

#
# This script builds the elbencho binary with RDMA support.
#
# Usage:
#   curl -LO https://raw.githubusercontent.com/noobaa/noobaa-core/master/src/deploy/elbencho-rdma-build.sh
#   bash elbencho-rdma-build.sh
#

BUILD_DIR=${BUILD_DIR:-./elbencho-rdma-build}
BUILD_MODE=${BUILD_MODE:-Release} # usage: <Release|Debug> to build with debug mode
CLEAN=${CLEAN:-0} # usage: 1 to clean the build and local-install dirs

# prepare dir structure
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"
AWS_C_S3_RDMA=$(realpath aws-c-s3-rdma)
AWS_SDK_CPP_RDMA=$(realpath aws-sdk-cpp-rdma)

# install build dependencies
if [ -f /etc/debian_version ]; then
  sudo apt -y install build-essential cmake debhelper devscripts fakeroot git libaio-dev \
  libboost-filesystem-dev libboost-program-options-dev libboost-thread-dev \
  libcurl4-openssl-dev libncurses-dev libnuma-dev lintian libssl-dev uuid-dev zlib1g-dev \
  golang
elif [ -f /etc/redhat-release ]; then
  sudo yum -y install boost-devel cmake gcc-c++ git libaio-devel libarchive libcurl-devel \
  libuuid-devel make ncurses-devel numactl-devel openssl-devel rpm-build zlib zlib-devel \
  golang
else
  echo "Unknown distro - install dependencies manually"
fi


# Step 1: build aws-c-s3 with RDMA support
# Fork https://github.com/KiranModukuri/aws-c-s3/tree/nvidia_rdma contains the base RDMA support.
# Fork https://github.com/guymguym/aws-c-s3/tree/nvidia_rdma has additional fixes

(
  if [ ! -d "aws-c-s3-rdma" ]; then
    git clone https://github.com/guymguym/aws-c-s3 aws-c-s3-rdma
    cd aws-c-s3-rdma
    git switch nvidia_rdma
    sed '
      s|export CUOBJECT_ROOT_DIR=.*$|export CUOBJECT_ROOT_DIR="/usr/local/cuda"|
      s|export CUOBJECT_LIB_DIR=.*|export CUOBJECT_LIB_DIR="$CUOBJECT_ROOT_DIR/lib64"|
      s|export CUFILE_LIB_DIR=.*|export CUFILE_LIB_DIR="$CUOBJECT_ROOT_DIR/lib64"|
      s|export CUFILE_RDMA_LIB_DIR=.*|export CUFILE_RDMA_LIB_DIR="$CUOBJECT_ROOT_DIR/lib64"|
      s|export CUFILE_INCLUDE_DIR=.*|export CUFILE_INCLUDE_DIR="$CUOBJECT_ROOT_DIR/include"|
      s|export CUFILE_ENV_PATH_JSON=.*|export CUFILE_ENV_PATH_JSON="/etc/cuobj.json"|
      /export AWS_ACCESS_KEY_ID=/d
      /export AWS_SECRET_ACCESS_KEY=/d
    ' scripts/env_rdma.sh.template > scripts/env_rdma.sh
  else
    cd aws-c-s3-rdma
  fi

  # log working tree status
  git --no-pager status --ignored || true
  git --no-pager diff || true

  source scripts/env_rdma.sh

  if [ ! -d "crt" ]; then
    ./scripts/bootstrap_crt.sh
  fi

  if [ "$CLEAN" = 1 ]; then
    rm -rf build local-install plugins/cuobject/build/
    ./scripts/build_all.sh # --rebuild-crt
  else
    ./scripts/build_all.sh
  fi

  # Output:
  #
  # [build_all] ✓ Build completed successfully!
  #
  # Artifacts:
  #   Core library:  aws-c-s3-rdma/local-install/lib/libaws-c-s3.a
  #   Plugin library: aws-c-s3-rdma/plugins/cuobject/build/libcuobject_s3_plugin.so
  #
  # RDMA support is ENABLED
)

# Step 2: build aws-sdk-cpp with RDMA support

(
  if [ ! -d "aws-sdk-cpp-rdma" ]; then
    git clone --recurse-submodules https://github.com/aws/aws-sdk-cpp.git aws-sdk-cpp-rdma
    cd aws-sdk-cpp-rdma

    # echo "Switching to tag v1.11.718 ..."
    # git checkout 1.11.718

    # Replacing crt libs with aws-c-s3-rdma versions ...
    cd crt/aws-crt-cpp/crt
    mv aws-c-s3 aws-c-s3.orig
    ln -s $AWS_C_S3_RDMA aws-c-s3
    LIBS=(aws-c-auth aws-c-cal aws-c-common aws-c-compression aws-checksums aws-c-http aws-c-io aws-c-sdkutils aws-lc)
    for i in "${LIBS[@]}"; do 
      mv $i $i.orig
      ln -s $AWS_C_S3_RDMA/crt/$i $i
    done
    cd -

  else
    cd aws-sdk-cpp-rdma
  fi

  if [ "$CLEAN" = 1 ]; then
    rm -rf build/ local-install/
  fi

  # log working tree status
  git --no-pager status --ignored || true
  git --no-pager diff || true

  # see https://github.com/breuner/elbencho/blob/master/README.md#build-elbencho-with-s3-support
  # see https://github.com/breuner/elbencho/blob/c4795a37064b9e4e2580abe97d642fd782aadba1/external/prepare-external.sh#L260-L273
  cmake -B build/ \
    -DCMAKE_INSTALL_PREFIX=$AWS_SDK_CPP_RDMA/local-install \
    -DCMAKE_BUILD_TYPE=$BUILD_MODE \
    -DCPP_STANDARD=17 \
    -DENABLE_TESTING=OFF \
    -DAUTORUN_UNIT_TESTS=OFF \
    -DENABLE_UNITY_BUILD=ON \
    -DBUILD_ONLY="s3-crt" \
    -DENFORCE_SUBMODULE_VERSIONS=OFF \
    -DUSE_CRT_HTTP_CLIENT=ON \
    -DBUILD_SHARED_LIBS=OFF \
    -DFORCE_SHARED_CRT=OFF \
    -DUSE_OPENSSL=OFF

  # -DAWS_USE_CRYPTO_SHARED_LIBS=OFF \
  # -DCMAKE_PREFIX_PATH=$AWS_C_S3_RDMA/local-install \
  # -DBUILD_DEPS=OFF \
  # -DFORCE_CURL=ON \
  # -DBYO_CRYPTO=ON \

  cmake --build build/ --config=$BUILD_MODE -j $(nproc)
  cmake --install build/ --config=$BUILD_MODE
)

# Step 3: build elbencho with RDMA support

(
  AWS_SDK_DIR="$AWS_SDK_CPP_RDMA/local-install"
  AWS_SDK_INCLUDE="$AWS_SDK_DIR/include"


  if [ -f /etc/debian_version ]; then
    AWS_SDK_LIB="$AWS_SDK_DIR/lib"
    BACKTRACE_SUPPORT=1
  elif [ -f /etc/redhat-release ]; then
    AWS_SDK_LIB="$AWS_SDK_DIR/lib64"
    BACKTRACE_SUPPORT=0
  fi

  if [ ! -d "elbencho-rdma" ]; then
    git clone https://github.com/breuner/elbencho elbencho-rdma
    cd elbencho-rdma

    cat <<'EOF' > elbencho-rdma.patch
diff --git a/Makefile b/Makefile
index 5cf6d4b..1ca3740 100644
--- a/Makefile
+++ b/Makefile
@@ -104,11 +104,37 @@ endif
 # "-Wno-overloaded-virtual" because AWS SDK shows a lot of warnings about this otherwise
 ifeq ($(S3_SUPPORT), 1)
   CXXFLAGS += -DS3_SUPPORT -Wno-overloaded-virtual
-  LDFLAGS  += -L $(EXTERNAL_PATH)/aws-sdk-cpp_install/lib* -l aws-sdk-all \
-	$(LDFLAGS_S3_DYNAMIC) $(LDFLAGS_S3_STATIC)

   ifeq ($(S3_AWSCRT), 1)
     CXXFLAGS += -DS3_AWSCRT
+    # For dynamic linking with AWS CRT, link specific shared libraries
+    ifeq ($(BUILD_STATIC), 1)
+      LDFLAGS  += -L $(EXTERNAL_PATH)/aws-sdk-cpp_install/lib* -l aws-sdk-all \
+        $(LDFLAGS_S3_DYNAMIC) $(LDFLAGS_S3_STATIC)
+    else
+      # Link all AWS CRT libraries in dependency order
+      LDFLAGS  += -L $(AWS_LIB_DIR) \
+        -l aws-cpp-sdk-s3-crt \
+        -l aws-cpp-sdk-core \
+        -l aws-crt-cpp \
+        -l aws-c-s3 \
+        -l aws-c-auth \
+        -l aws-c-http \
+        -l aws-c-mqtt \
+        -l aws-c-event-stream \
+        -l aws-c-io \
+        -l aws-c-cal \
+        -l aws-c-compression \
+        -l aws-c-sdkutils \
+        -l aws-checksums \
+        -l aws-c-common \
+        -l s2n \
+        -l crypto \
+        $(LDFLAGS_S3_DYNAMIC)
+    endif
+  else
+    LDFLAGS  += -L $(EXTERNAL_PATH)/aws-sdk-cpp_install/lib* -l aws-sdk-all \
+      $(LDFLAGS_S3_DYNAMIC) $(LDFLAGS_S3_STATIC)
   endif

   # Apply user-provided AWS SDK include dir if given
@@ -301,6 +327,7 @@ $(OBJECTS): Makefile | externals features-info # Makefile dep to rebuild all on
 externals:
 # Note: The "+" prefix is to let "make" know that it needs to increase the MAKELEVEL env var because
 # there will be sub-make calls in this script.
+ifeq ($(BUILD_STATIC), 1)
 ifdef BUILD_VERBOSE
 	+PREP_AWS_SDK=$(S3_SUPPORT) S3_AWSCRT=$(S3_AWSCRT) AWS_LIB_DIR=$(AWS_LIB_DIR) \
 		AWS_INCLUDE_DIR=$(AWS_INCLUDE_DIR) PREP_MIMALLOC=$(USE_MIMALLOC) \
@@ -312,6 +339,7 @@ else
 		PREP_UWS=$(ALTHTTPSVC_SUPPORT) PREP_LIBBACKTRACE=$(PREP_LIBBACKTRACE) \
 		$(EXTERNAL_PATH)/prepare-external.sh
 endif
+endif


 features-info:
EOF

    git apply elbencho-rdma.patch
  else
    cd elbencho-rdma
  fi

  if [ "$CLEAN" = 1 ]; then
    make clean-all
  fi

  # log working tree status
  git --no-pager status --ignored || true
  git --no-pager diff || true

  ./external/prepare-external.sh

  make -j$(nproc) \
    S3_SUPPORT=1 \
    S3_AWSCRT=1 \
    CUDA_SUPPORT=1 \
    CUFILE_SUPPORT=1 \
    BACKTRACE_SUPPORT=$BACKTRACE_SUPPORT \
    BUILD_DEBUG=$([ "$BUILD_MODE" = "Debug" ] && echo 1 || echo 0) \
    BUILD_STATIC=0 \
    BUILD_VERBOSE=1 \
    AWS_LIB_DIR=$AWS_SDK_LIB \
    AWS_INCLUDE_DIR=$AWS_SDK_INCLUDE
)

cp elbencho-rdma/bin/elbencho .
cp aws-c-s3-rdma/plugins/cuobject/build/libcuobject_s3_plugin.so .
ldd elbencho
ldd libcuobject_s3_plugin.so

echo "Build completed successfully!"

cat <<EOF

Artifacts:
  Elbencho binary: elbencho
  Plugin library: libcuobject_s3_plugin.so

Example:
  
  function elb() {
    CUOBJECT_DEBUG_LOGGING=0 \
    AWS_S3_FORCE_RDMA=1 \
    AWS_S3_RDMA_THRESHOLD_BYTES=1048576 \
    AWS_S3_RDMA_PLUGIN_PATH="$(realpath libcuobject_s3_plugin.so)" \
    CUOBJECT_RDMA_BYTES_HEADER_NAME="x-amz-rdma-bytes-transferred" \
    CUFILE_ENV_PATH_JSON="/etc/cuobj.json" \
    $(realpath elbencho) \
    --cpu --lat --live1n --latpercent \
    --s3key "\$AWS_ACCESS_KEY_ID" \
    --s3secret "\$AWS_SECRET_ACCESS_KEY" \
    --s3endpoints "\$AWS_ENDPOINT_URL" \
    "\$S3_BUCKET" \
    --s3objprefix "16MB/" \
    --size 16m \
    --block 16m \
    --files 32 \
    --dirs 1 \
    --threads 32 \
    "\$@"
  }

  # define S3 connection details (AWS_ENDPOINT_URL, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET)
  # set manually or for example can be loaded from AWS CLI config

  AWS_ENDPOINT_URL=\$(aws configure get endpoint_url)
  AWS_ACCESS_KEY_ID=\$(aws configure get aws_access_key_id)
  AWS_SECRET_ACCESS_KEY=\$(aws configure get aws_secret_access_key)
  S3_BUCKET="elbencho-rdma-test"

  # Run benchmarks:
  elb -w
  elb -r

  # Read continuously for 30 seconds
  elb -r --infloop --timelimit 30

  # with data verification
  elb -w --verify 42
  elb -r --verify 42

  # with GPU memory (and verification)
  elb -w --gpuids all --verify 420
  elb -r --gpuids all --verify 420

  # cleanup
  elb -F

EOF
