#!/bin/bash

set -eou pipefail
set -x

TARGET="noobaa-core.tar.gz"

SRC_DIR=$(realpath "${1:-$(pwd)}")

function prepare_excludes() {
	local exclude_flag_gitignore="$(grep -v '^#' $SRC_DIR/.gitignore | grep '[^[:blank:]]' | xargs -I{} printf '%s=%s ' '--exclude' '{}')"
	local exclude_flag_local="--exclude ./build --exclude ./images --exclude ./tools --exclude ./submodules --exclude .github --exclude .travis --exclude .jenkins"

	echo "${exclude_flag_gitignore} ${exclude_flag_local}"
}

function archive() {
	local tar="$1"
	local exclude_flag="$(prepare_excludes)"

	# No quotes here is intentional
	tar $exclude_flag --exclude-vcs -czvf "$tar" "$SRC_DIR"
}

echo "Using source: $SRC_DIR"
if [ "$SRC_DIR" = "$(pwd)" ]; then
	pushd ..
	tpath="$TMPDIR$TARGET"
	archive "$tpath"
	popd

	mv "$tpath" .
else
	tpath="./$TARGET"
	archive "$tpath"
fi