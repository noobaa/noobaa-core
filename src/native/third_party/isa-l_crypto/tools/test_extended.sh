#!/usr/bin/env bash

# Extended tests: Run a few more options other than make check

set -xe #exit on fail

# Defaults
cpus=1
S=$RANDOM
MAKE=make
READLINK=readlink
test_level=check
build_opt=''
msg=''

# Override defaults if exist
command -V gmake >/dev/null 2>&1 && MAKE=gmake
command -V greadlink >/dev/null 2>&1 && READLINK=greadlink
[ -n "$CC" ] && build_opt+="CC=$CC "
[ -n "$AS" ] && build_opt+="AS=$AS "

out="$PWD"
src=$($READLINK -f $(dirname $0))/..
cd "$src"

# Run on mult cpus
if command -V lscpu >/dev/null 2>&1; then
    cpus=`lscpu -p | tail -1 | cut -d, -f 2`
    cpus=$(($cpus + 1))
elif command -V sysctl; then
    if sysctl -n hw.ncpu >/dev/null 2>&1; then
	cpus=$(sysctl -n hw.ncpu)
	cpus=$(($cpus + 1))
    fi
fi
echo "Using $cpus cpu threads"

if [ -z "$S" ]; then
    S=`tr -cd 0-9 </dev/urandom | head -c 4 | sed -e 's/^0*/1/g'`
    [ "$S" -gt 0 ] 2> /dev/null || S="123"
fi
msg+="Running with TEST_SEED=$S".$'\n'

# Fix Darwin issues
if uname | grep -q 'Darwin' 2>&1; then
    export SED=`which sed`
fi

# Check for test libs to add
if command -V ldconfig >/dev/null 2>&1; then
    if ldconfig -p | grep -q libcrypto.so; then
	test_level=test
	msg+=$'With extra tests\n'
    fi
    if ldconfig -p | grep -q libefence.so; then
	build_opt+="LDFLAGS+='-lefence' "
	msg+=$'With efence\n'
    fi
fi

# Std makefile build test
$MAKE -f Makefile.unx clean
time $MAKE -f Makefile.unx -j $cpus $build_opt
msg+=$'Std makefile build: Pass\n'

# Check for gnu executable stack set
if command -V readelf >/dev/null 2>&1; then
    if readelf -W -l bin/libisal.so | grep 'GNU_STACK' | grep -q 'RWE'; then
	echo $0: Stack NX check bin/libisal.so: Fail
	exit 1
    else
	msg+=$'Stack NX check bin/lib/libisal.so: Pass\n'
    fi
else
    msg+=$'Stack NX check not supported: Skip\n'
fi

# Std makefile build perf tests
time $MAKE -f Makefile.unx -j $cpus perfs
msg+=$'Std makefile build perf: Pass\n'

# Std makefile run tests
time $MAKE -f Makefile.unx -j $cpus $build_opt $test_level
msg+=$'Std makefile tests: Pass\n'

# Std makefile build other
time $MAKE -f Makefile.unx -j $cpus $build_opt other
msg+=$'Other tests build: Pass\n'

$MAKE -f Makefile.unx clean

set +x
echo
echo "Summary test $0:"
echo "Build opt: $build_opt"
echo "$msg"
echo "$0: Final: Pass"
