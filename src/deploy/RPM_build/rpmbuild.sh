#!/bin/bash
set -eou pipefail
set -x

SKIP_NODE_INSTALL=1 source ./src/deploy/NVA_build/install_nodejs.sh
NODE_PATH="${NODE_PATH:-/usr/local/node}"

noobaaver="$(npm pkg get version | tr -d '"')"
releasedate=$(date '+%a %b %d %Y')
nodever=$(node --version | tr -d 'v')
revision="$(date -u '+%Y%m%d')"
changelogdata="Initial release of NooBaa ${noobaaver}"
ARCHITECTURE=$(uname -m)

SRC_DIR=$(realpath "$1")
BUILD_DIR="${2:-/tmp}"

SPEC_TEMPLATE="./src/deploy/RPM_build/noobaa.spec"
RPMBUILD_DIR="$BUILD_DIR/rpmbuild"
SPEC_FILE="$RPMBUILD_DIR/SPECS/noobaa.spec"
SOURCE_TAR="$RPMBUILD_DIR/SOURCES/noobaa-core-${noobaaver}-${revision}.tar.gz"

mkdir -p $RPMBUILD_DIR/{BUILD,RPMS,SOURCES,SPECS,SRPMS}

function create_source_tar() {
    exclude_flag_local="--exclude ./build --exclude ./images --exclude ./tools --exclude ./submodules --exclude .github --exclude .travis --exclude .jenkins"

    # using awk to parse .gitignore and create --exclude flags, ignoring comments and empty lines, and making paths relative
    exclude_flag_gitignore="$(awk '!/^[[:blank:]]*(#|$)/ { $1=$1; c1=substr($0,1,1); printf "--exclude=%s%s ",(c1=="/" ? "." : ""),$0; }' .gitignore)"

    # No quotes around flags is intentional
    tar $exclude_flag_local $exclude_flag_gitignore --exclude-vcs -czvf $SOURCE_TAR $SRC_DIR
}

function set_changelog() {
    if [ -f changelog.txt ]; then
        local path=$(realpath changelog.txt)
        changelogdata="%{lua: print(io.open(\"$path\"):read(\"*a\"))}"
    fi
}

# Generate the spec file from the template by replacing '%define NAME null' 
# with the corresponding variable values from the script environment.
function generate_spec_from_template() {
    ls -l $SPEC_TEMPLATE
    ls -l $RPMBUILD_DIR/SPECS/
    cat $SPEC_FILE || true
    : >"$SPEC_FILE" # Truncate or create empty spec file
    while IFS= read -r line; do
        # Check if the line starts with '%define' and contains 'null'
        if [[ $line =~ ^%define[[:space:]]+([^[:space:]]+)[[:space:]]+null$ ]]; then
            # Extract the variable name
            VAR_NAME="${BASH_REMATCH[1]}"

            # Get the value of the variable using indirect expansion
            VAR_VALUE="${!VAR_NAME}"

            # Replace 'null' with the variable value
            line="${line/null/$VAR_VALUE}"
        fi

        # Write the updated line to the output file
        echo "$line" >>$SPEC_FILE
    done <$SPEC_TEMPLATE
    cat $SPEC_FILE || true
}

function build_rpm() {
    # Print the generated spec file if NRPM_DEBUG is set to true
    [[ "${NRPM_DEBUG:-false}" == "true" ]] && cat $SPEC_FILE

    if [[ "$SRPM_ONLY" = "true" ]]; then
        rpmbuild --define "_topdir $RPMBUILD_DIR" -bs $SPEC_FILE
    else
        rpmbuild --define "_topdir $RPMBUILD_DIR" -ba $SPEC_FILE

        # Move the RPM package to the build directory
        mv $RPMBUILD_DIR/RPMS/${ARCHITECTURE}/noobaa-core-${noobaaver}-${revision}.*.rpm $BUILD_DIR/
    fi
    # Move the SRPM package to the build directory
    mv $RPMBUILD_DIR/SRPMS/noobaa-core-${noobaaver}-${revision}.*.rpm $BUILD_DIR/
}

create_source_tar
set_changelog
generate_spec_from_template
build_rpm
