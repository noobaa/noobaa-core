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
    export CXXFLAGS=-I/usr/local/opt/openssl/include/
    export CMAKE_ARGS="-DCUSTOM_MEMORY_MANAGEMENT=0 -Wno-dev"
    if [ -f CMakeCache.txt ]
    then
        cmake . $CMAKE_ARGS
    else
        cmake ../src $CMAKE_ARGS
    fi
}

function sdk_make() {
    log "SDK: MAKE"
    make aws-cpp-sdk-core aws-cpp-sdk-s3 aws-cpp-sdk-transfer
}

function sdk_build() {
    sdk_get_sources
    pushd bld
    sdk_cmake
    sdk_make
    popd
}

function demo_compile() {
    log "DEMO: COMPILE"
    source="../../`dirname $0`/s3-demo.cpp"
    g++ \
        -Isrc/aws-cpp-sdk-core/include \
        -Lbld/aws-cpp-sdk-core/ \
        -laws-cpp-sdk-core \
        -Isrc/aws-cpp-sdk-s3/include \
        -Lbld/aws-cpp-sdk-s3/ \
        -laws-cpp-sdk-s3 \
        -std=c++17 \
        -lstdc++ \
        -o s3-demo $source
    # -stdlib=libstdc++ \
    # -stdlib=libc++ \
    log "DEMO: COMPILED  -->  \"$BUILD_DIR/s3-demo\""
}

function build() {
    mkdir -p $BUILD_DIR/bld
    pushd $BUILD_DIR
    if [ ! -z "$1" ]
    then
        log "FORCE BUILD SDK"
        sdk_build
    elif [ ! -f bld/aws-cpp-sdk-s3/libaws-cpp-sdk-s3.* ]
    then
        log "BUILD SDK"
        sdk_build
    fi
    demo_compile
    popd # $BUILD_DIR
}

build $1
