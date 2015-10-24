BUILD_DIR="build/aws-cpp-sdk"

function log() {
    echo
    echo
    echo " =====> $*"
    echo
}

function sdk_get_sources() {
    if [ -f src/CMakeLists.txt ]
    then
        pushd src
        log "SDK: GIT STATUS"
        git status
        log "SDK: GIT PULL"
        git pull
        popd
    else
        log "SDK: GIT CLONE"
        git clone https://github.com/awslabs/aws-sdk-cpp.git src
    fi
}

function sdk_cmake() {
    log "SDK: CMAKE"
    export CMAKE_CXX_FLAGS="-I/usr/local/opt/openssl/include/"
    export CMAKE_ARGS="-DCUSTOM_MEMORY_MANAGEMENT=0 -Wno-dev"
    if [ -f CMakeCache.txt ]
    then
        cmake . $CMAKE_ARGS
    else
        cmake ./src $CMAKE_ARGS
    fi
}

function sdk_make_s3() {
    log "SDK: MAKE S3"
    make aws-cpp-sdk-s3
}

function sdk_build() {
    sdk_get_sources
    sdk_cmake
    sdk_make_s3
}

function demo_compile() {
    log "DEMO: COMPILE"
    g++ \
        -Isrc/aws-cpp-sdk-core/include \
        -Laws-cpp-sdk-core/ \
        -laws-cpp-sdk-core \
        -Isrc/aws-cpp-sdk-s3/include \
        -Laws-cpp-sdk-s3/ \
        -laws-cpp-sdk-s3 \
        -std=c++11 \
        -stdlib=libc++ \
        -lstdc++ \
        -o s3-demo \
        ../../src/native/aws-cpp-sdk/s3-demo.cpp
        # -stdlib=libstdc++ \
    log "DEMO: COMPILED  -->  \"$BUILD_DIR/s3-demo\""
}

function build() {
    mkdir -p $BUILD_DIR
    pushd $BUILD_DIR
    if [ ! -z "$1" ]
    then
        log "FORCE BUILD SDK"
        sdk_build
    elif [ ! -f aws-cpp-sdk-s3/libaws-cpp-sdk-s3.*lib ]
    then
        log "BUILD SDK"
        sdk_build
    fi
    demo_compile
    popd # $BUILD_DIR
}

build
