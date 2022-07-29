cmake_minimum_required(VERSION 3.0)

# use, i.e. don't skip the full RPATH for the build tree
set(CMAKE_SKIP_BUILD_RPATH  FALSE)

# when building, don't use the install RPATH already
# (but later on when installing)
set(CMAKE_BUILD_WITH_INSTALL_RPATH FALSE)

SET(CMAKE_INSTALL_RPATH "${CMAKE_INSTALL_PREFIX}/lib")

# add the automatically determined parts of the RPATH
# which point to directories outside the build tree to the install RPATH
set(CMAKE_INSTALL_RPATH_USE_LINK_PATH TRUE)

project(cm256cc)

set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(MAJOR_VERSION 1)
set(MINOR_VERSION 1)
set(PATCH_VERSION 0)
set(PACKAGE libcm256cc)
set(VERSION_STRING ${MAJOR_VERSION}.${MINOR_VERSION}.${PATCH_VERSION})
set(VERSION ${VERSION_STRING})

option(BUILD_TOOLS "Build unit test tools" ON)

include(GNUInstallDirs)
set(LIB_INSTALL_DIR "${CMAKE_INSTALL_LIBDIR}") # "lib" or "lib64"

if (BUILD_TYPE MATCHES RELEASE)
    set(CMAKE_BUILD_TYPE "Release")
elseif (BUILD_TYPE MATCHES RELEASEWITHDBGINFO)
    set(CMAKE_BUILD_TYPE "ReleaseWithDebugInfo")
elseif (BUILD_TYPE MATCHES DEBUG)
    set(CMAKE_BUILD_TYPE "Debug")
else()
    set(CMAKE_BUILD_TYPE "Release")
endif()

##############################################################################

set(TEST_DIR ${PROJECT_SOURCE_DIR}/cmake/test)

# Clang or AppleClang (see CMP0025)
if(NOT DEFINED C_CLANG AND CMAKE_CXX_COMPILER_ID MATCHES "Clang")
    set(C_CLANG 1)
endif()
if(NOT DEFINED C_GCC AND CMAKE_CXX_COMPILER_ID MATCHES "GNU")
    set(C_GCC 1)
endif()

# Detect current compilation architecture and create standard definitions
# =======================================================================
include(CheckSymbolExists)
function(detect_architecture symbol arch)
    if (NOT DEFINED ARCHITECTURE)
        set(CMAKE_REQUIRED_QUIET 1)
        check_symbol_exists("${symbol}" "" ARCHITECTURE_${arch})
        unset(CMAKE_REQUIRED_QUIET)

        # The output variable needs to be unique across invocations otherwise
        # CMake's crazy scope rules will keep it defined
        if (ARCHITECTURE_${arch})
            set(ARCHITECTURE "${arch}" PARENT_SCOPE)
            set(ARCHITECTURE_${arch} 1 PARENT_SCOPE)
            add_definitions(-DARCHITECTURE_${arch}=1)
        endif()
    endif()
endfunction()

if (NOT ENABLE_GENERIC)
    if (MSVC)
        detect_architecture("_M_AMD64" x86_64)
        detect_architecture("_M_IX86" x86)
        detect_architecture("_M_ARM" ARM)
        detect_architecture("_M_ARM64" ARM64)
    else()
        detect_architecture("__x86_64__" x86_64)
        detect_architecture("__i386__" x86)
        detect_architecture("__arm__" ARM)
        detect_architecture("__aarch64__" ARM64)
    endif()
endif()
if (NOT DEFINED ARCHITECTURE)
    set(ARCHITECTURE "GENERIC")
    set(ARCHITECTURE_GENERIC 1)
    add_definitions(-DARCHITECTURE_GENERIC=1)
endif()
message(STATUS "Target architecture: ${ARCHITECTURE}")

# flag that set the minimum cpu flag requirements
# used to create re-distribuitable binary
if (ENABLE_DISTRIBUTION)
    if (${ARCHITECTURE} MATCHES "x86_64|x86")
        set(HAS_SSSE3 ON CACHE BOOL "SSSE3 SIMD enabled")
        if(C_GCC OR C_CLANG)
            set( CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -mssse3" )
            message(STATUS "Use SSSE3 SIMD instructions")
            add_definitions(-DUSE_SSSE3)
        elseif(MSVC)
            set( CMAKE_CXX_FLAGS_DEBUG "${CMAKE_CXX_FLAGS_DEBUG} /arch:SSSE3" )
            set( CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} /Oi /GL /Ot /Ox /arch:SSSE3" )
            set( CMAKE_EXE_LINKER_FLAGS_RELEASE "${CMAKE_EXE_LINKER_FLAGS_RELEASE} /LTCG" )
            message(STATUS "Use MSVC SSSE3 SIMD instructions")
            add_definitions (/D "_CRT_SECURE_NO_WARNINGS")
            add_definitions(-DUSE_SSSE3)
        endif()
    elseif (${ARCHITECTURE} MATCHES "ARM|ARM64")
        set(HAS_NEON ON CACHE BOOL "NEON SIMD enabled")
        message(STATUS "Use NEON SIMD instructions")
        add_definitions(-DUSE_NEON)
    endif()
else ()
if (${ARCHITECTURE} MATCHES "x86_64|x86")
    try_run(RUN_SSE2 COMPILE_SSE2 ${CMAKE_BINARY_DIR}/tmp ${TEST_DIR}/test_x86_sse2.cxx COMPILE_DEFINITIONS -msse2 -O0)
    if(COMPILE_SSE2 AND RUN_SSE2 EQUAL 0)
       set(HAS_SSE2 ON CACHE BOOL "Architecture has SSSE2 SIMD enabled")
       if(C_GCC OR C_CLANG)
           set( CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -msse2" )
           message(STATUS "Use SSE2 SIMD instructions")
           add_definitions(-DUSE_SSE2)
       elseif(MSVC)
           set( CMAKE_CXX_FLAGS_DEBUG "${CMAKE_CXX_FLAGS_DEBUG} /arch:SSE2" )
           set( CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} /Oi /GL /Ot /Ox /arch:SSE2" )
           set( CMAKE_EXE_LINKER_FLAGS_RELEASE "${CMAKE_EXE_LINKER_FLAGS_RELEASE} /LTCG" )
           add_definitions (/D "_CRT_SECURE_NO_WARNINGS")
           add_definitions(-DUSE_SSE2)
       endif()
    else()
       set(HAS_SSE2 OFF CACHE BOOL "Architecture does not have SSSE2 SIMD enabled")
    endif()
    try_run(RUN_SSSE3 COMPILE_SSSE3 ${CMAKE_BINARY_DIR}/tmp ${TEST_DIR}/test_x86_ssse3.cxx COMPILE_DEFINITIONS -mssse3 -O0)
    if(COMPILE_SSSE3 AND RUN_SSSE3 EQUAL 0)
       set(HAS_SSSE3 ON CACHE BOOL "Architecture has SSSE3 SIMD enabled")
       if(C_GCC OR C_CLANG)
           set( CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -mssse3" )
           message(STATUS "Use SSSE3 SIMD instructions")
           add_definitions(-DUSE_SSSE3)
       elseif(MSVC)
           set( CMAKE_CXX_FLAGS_DEBUG "${CMAKE_CXX_FLAGS_DEBUG} /arch:SSSE3" )
           set( CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} /Oi /GL /Ot /Ox /arch:SSSE3" )
           set( CMAKE_EXE_LINKER_FLAGS_RELEASE "${CMAKE_EXE_LINKER_FLAGS_RELEASE} /LTCG" )
           message(STATUS "Use MSVC SSSE3 SIMD instructions")
           add_definitions (/D "_CRT_SECURE_NO_WARNINGS")
           add_definitions(-DUSE_SSSE3)
       endif()
    else()
       set(HAS_SSSE3 OFF CACHE BOOL "Architecture does not have SSSE3 SIMD enabled")
    endif()
    try_run(RUN_SSE4_1 COMPILE_SSE4_1 ${CMAKE_BINARY_DIR}/tmp ${TEST_DIR}/test_x86_sse41.cxx COMPILE_DEFINITIONS -msse4.1 -O0)
    if(COMPILE_SSE4_1 AND RUN_SSE4_1 EQUAL 0)
       set(HAS_SSE4_1 ON CACHE BOOL "Architecture has SSE 4.1 SIMD enabled")
       if(C_GCC OR C_CLANG)
           set( CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -msse4.1" )
           set( CMAKE_CXX_FLAGS_DEBUG "${CMAKE_CXX_FLAGS_DEBUG} -msse4.1" )
           message(STATUS "Use SSE 4.1 SIMD instructions")
           add_definitions(-DUSE_SSE4_1)
       elseif(MSVC)
           set( CMAKE_CXX_FLAGS_DEBUG "${CMAKE_CXX_FLAGS_DEBUG} /arch:SSE4_1" )
           set( CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} /Oi /GL /Ot /Ox /arch:SSE4_1" )
           set( CMAKE_EXE_LINKER_FLAGS_RELEASE "${CMAKE_EXE_LINKER_FLAGS_RELEASE} /LTCG" )
           add_definitions (/D "_CRT_SECURE_NO_WARNINGS")
           add_definitions(-DUSE_SSE4_1)
       endif()
    else()
       set(HAS_SSE4_1 OFF CACHE BOOL "Architecture does not have SSE 4.1 SIMD enabled")
    endif()
    try_run(RUN_SSE4_2 COMPILE_SSE4_2 ${CMAKE_BINARY_DIR}/tmp ${TEST_DIR}/test_x86_sse42.cxx COMPILE_DEFINITIONS -msse4.2 -O0)
    if(COMPILE_SSE4_2 AND RUN_SSE4_2 EQUAL 0)
       set(HAS_SSE4_2 ON CACHE BOOL "Architecture has SSE 4.2 SIMD enabled")
       if(C_GCC OR C_CLANG)
           set( CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -msse4.2" )
           set( CMAKE_CXX_FLAGS_DEBUG "${CMAKE_CXX_FLAGS_DEBUG} -msse4.2" )
           message(STATUS "Use SSE 4.2 SIMD instructions")
           add_definitions(-DUSE_SSE4_2)
       elseif(MSVC)
           set( CMAKE_CXX_FLAGS_DEBUG "${CMAKE_CXX_FLAGS_DEBUG} /arch:SSE4_2" )
           set( CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} /Oi /GL /Ot /Ox /arch:SSE4_2" )
           set( CMAKE_EXE_LINKER_FLAGS_RELEASE "${CMAKE_EXE_LINKER_FLAGS_RELEASE} /LTCG" )
           add_definitions (/D "_CRT_SECURE_NO_WARNINGS")
           add_definitions(-DUSE_SSE4_2)
       endif()
    else()
       set(HAS_SSE4_2 OFF CACHE BOOL "Architecture does not have SSE 4.2 SIMD enabled")
    endif()
    try_run(RUN_AVX COMPILE_AVX ${CMAKE_BINARY_DIR}/tmp ${TEST_DIR}/test_x86_avx.cxx COMPILE_DEFINITIONS -mavx -O0)
    if(COMPILE_AVX AND RUN_AVX EQUAL 0)
       set(HAS_AVX ON CACHE BOOL "Architecture has AVX SIMD enabled")
       if(C_GCC OR C_CLANG)
           set( CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -mavx" )
           set( CMAKE_CXX_FLAGS_DEBUG "${CMAKE_CXX_FLAGS_DEBUG} -mavx" )
           message(STATUS "Use AVX SIMD instructions")
           add_definitions(-DUSE_AVX)
       endif()
    else()
       set(HAS_AVX OFF CACHE BOOL "Architecture does not have AVX SIMD enabled")
    endif()
    try_run(RUN_AVX2 COMPILE_AVX2 ${CMAKE_BINARY_DIR}/tmp ${TEST_DIR}/test_x86_avx2.cxx COMPILE_DEFINITIONS -mavx2 -O0)
    if(COMPILE_AVX2 AND RUN_AVX2 EQUAL 0)
       set(HAS_AVX2 ON CACHE BOOL "Architecture has AVX2 SIMD enabled")
       if(C_GCC OR C_CLANG)
           set( CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -mavx2" )
           set( CMAKE_CXX_FLAGS_DEBUG "${CMAKE_CXX_FLAGS_DEBUG} -mavx2" )
           message(STATUS "Use AVX2 SIMD instructions")
           add_definitions(-DUSE_AVX2)
       endif()
    else()
       set(HAS_AVX2 OFF CACHE BOOL "Architecture does not have AVX2 SIMD enabled")
    endif()
    try_run(RUN_AVX512 COMPILE_AVX512 ${CMAKE_BINARY_DIR}/tmp ${TEST_DIR}/test_x86_avx512.cxx COMPILE_DEFINITIONS -mavx512f -O0)
    if(COMPILE_AVX512 AND RUN_AVX512 EQUAL 0)
       set(HAS_AVX512 ON CACHE BOOL "Architecture has AVX512 SIMD enabled")
       if(C_GCC OR C_CLANG)
           set( CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -mavx512f" )
           set( CMAKE_CXX_FLAGS_DEBUG "${CMAKE_CXX_FLAGS_DEBUG} -mavx512f" )
           message(STATUS "Use AVX512 SIMD instructions")
           add_definitions(-DUSE_AVX512)
       endif()
    else()
       set(HAS_AVX512 OFF CACHE BOOL "Architecture does not have AVX512 SIMD enabled")
    endif()
elseif(ARCHITECTURE_ARM)
    try_run(RUN_NEON COMPILE_NEON ${CMAKE_BINARY_DIR}/tmp ${TEST_DIR}/test_arm_neon.cxx COMPILE_DEFINITIONS -mfpu=neon -O0)
    if(COMPILE_NEON AND RUN_NEON EQUAL 0)
       set(HAS_NEON ON CACHE BOOL "Architecture has NEON SIMD enabled")
       if(C_GCC OR C_CLANG)
           set( CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -mfpu=neon" )
           set( CMAKE_CXX_FLAGS_DEBUG "${CMAKE_CXX_FLAGS_DEBUG} -mfpu=neon" )
           message(STATUS "Use NEON SIMD instructions")
           add_definitions(-DUSE_NEON)
       endif()
    else()
       set(HAS_NEON OFF CACHE BOOL "Architecture does not have NEON SIMD enabled")
    endif()
elseif(ARCHITECTURE_ARM64)
    # Advanced SIMD (aka NEON) is mandatory for AArch64
    set(HAS_NEON ON CACHE BOOL "Architecture has NEON SIMD enabled")
    message(STATUS "Use NEON SIMD instructions")
    add_definitions(-DUSE_NEON)
endif()
endif()

# clear binary test folder
FILE(REMOVE_RECURSE ${CMAKE_BINARY_DIR}/tmp)
##############################################################################

if(HAS_SSSE3)
    message(STATUS "Architecture supports SSSE3 - OK")
elseif(HAS_NEON)
    message(STATUS "Architecture supports Neon - OK")
else()
    message(STATUS "Unsupported architecture - Terminated")
    return()
endif()

# Compiler flags.
if(MSVC)
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wall ${EXTRA_FLAGS}")
else()
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wall -Wextra -O3 -ffast-math -ftree-vectorize ${EXTRA_FLAGS}")
endif()

if (CMAKE_CXX_COMPILER_ID STREQUAL "GNU" AND NOT CMAKE_CXX_COMPILER_ID MATCHES "Clang")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fmax-errors=10")
endif()
set( CMAKE_CXX_FLAGS_DEBUG "${CMAKE_CXX_FLAGS_DEBUG} -std=c++11" )
set( CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -std=c++11" )
add_definitions(-DNO_RESTRICT)

set(cm256_SOURCES
  cm256.cpp
  gf256.cpp
)

set(cm256_HEADERS
  cm256.h
  gf256.h
  sse2neon.h
  export.h
)

include_directories(
    .
    ${CMAKE_CURRENT_BINARY_DIR}
    ${Boost_INCLUDE_DIRS}
)

add_library(cm256cc SHARED
  ${cm256_SOURCES}
)
set_target_properties(cm256cc PROPERTIES VERSION ${VERSION} SOVERSION ${MAJOR_VERSION})

# single pass test
if(BUILD_TOOLS)
add_executable(cm256_test
  unit_test/cm256_test.cpp
)

target_include_directories(cm256_test PUBLIC
    ${PROJECT_SOURCE_DIR}
    ${CMAKE_CURRENT_BINARY_DIR}
)

target_link_libraries(cm256_test cm256cc)

# transmit side test

add_executable(cm256_tx
  unit_test/mainutils.cpp
  unit_test/UDPSocket.cpp
  unit_test/example0.cpp
  unit_test/example1.cpp
  unit_test/transmit.cpp
)

target_include_directories(cm256_tx PUBLIC
    ${PROJECT_SOURCE_DIR}
    ${CMAKE_CURRENT_BINARY_DIR}
)

target_link_libraries(cm256_tx cm256cc)

# receive side test

add_executable(cm256_rx
  unit_test/mainutils.cpp
  unit_test/UDPSocket.cpp
  unit_test/example0.cpp
  unit_test/example1.cpp
  unit_test/receive.cpp
)

target_include_directories(cm256_rx PUBLIC
    ${PROJECT_SOURCE_DIR}
    ${CMAKE_CURRENT_BINARY_DIR}
)

target_link_libraries(cm256_rx cm256cc)
endif(BUILD_TOOLS)

########################################################################
# Create Pkg Config File
########################################################################

# use space-separation format for the pc file
STRING(REPLACE ";" " " CM256CC_PC_REQUIRES "${CM256CC_PC_REQUIRES}")
STRING(REPLACE ";" " " CM256CC_PC_CFLAGS "${CM256CC_PC_CFLAGS}")
STRING(REPLACE ";" " " CM256CC_PC_LIBS "${CM256CC_PC_LIBS}")

# unset these vars to avoid hard-coded paths to cross environment
IF(CMAKE_CROSSCOMPILING)
    UNSET(CM256CC_PC_CFLAGS)
    UNSET(CM256CC_PC_LIBS)
ENDIF(CMAKE_CROSSCOMPILING)

CONFIGURE_FILE(
    ${CMAKE_CURRENT_SOURCE_DIR}/libcm256cc.pc.in
    ${CMAKE_CURRENT_BINARY_DIR}/libcm256cc.pc
@ONLY)

INSTALL(
    FILES ${CMAKE_CURRENT_BINARY_DIR}/libcm256cc.pc
    DESTINATION ${LIB_INSTALL_DIR}/pkgconfig
)


# Installation
if(BUILD_TOOLS)
    install(TARGETS cm256_test cm256_tx cm256_rx DESTINATION bin)
endif(BUILD_TOOLS)
install(TARGETS cm256cc DESTINATION  ${LIB_INSTALL_DIR})
install(FILES ${cm256_HEADERS} DESTINATION include/${PROJECT_NAME})
