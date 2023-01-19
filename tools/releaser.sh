#!/bin/bash

set -euo pipefail
set -x

export PS4='\e[36m+ ${FUNCNAME:-main}@${BASH_SOURCE}:${LINENO} \e[0m'

dir=$(dirname "$0")

# Default values for the arguments.
GH_ORG="noobaa"
GH_REPO="noobaa-core"
OCI_ORG="noobaa"
DRY_RUN="false"
SYNC_OPERATOR_REPOSITORY=""

# Default values for the environment variables.
GITHUB_TOKEN=${GITHUB_TOKEN:-}
DOCKERHUB_USERNAME=${DOCKERHUB_USERNAME:-}
DOCKERHUB_TOKEN=${DOCKERHUB_TOKEN:-}
QUAY_USERNAME=${QUAY_USERNAME:-}
QUAY_TOKEN=${QUAY_TOKEN:-}
BASE_BRANCH=${BASE_BRANCH:-master}

function check_environment_variables() {
  if [[ -z "${GITHUB_TOKEN}" ]]; then
    echo "GITHUB_TOKEN environment variable is not set."
    exit 1
  fi
  if [[ -z "${DOCKERHUB_USERNAME}" ]]; then
    echo "DOCKERHUB_USERNAME environment variable is not set."
    exit 1
  fi
  if [[ -z "${DOCKERHUB_TOKEN}" ]]; then
    echo "DOCKERHUB_TOKEN environment variable is not set."
    exit 1
  fi
  if [[ -z "${QUAY_USERNAME}" ]]; then
    echo "QUAY_USERNAME environment variable is not set."
    exit 1
  fi
  if [[ -z "${QUAY_TOKEN}" ]]; then
    echo "QUAY_TOKEN environment variable is not set."
    exit 1
  fi
}

function usage() {
  echo "Usage: $0 [options]"
  echo "Options:"
  echo "  --help - Print this help message."
  echo "  --oci-org <org> - The organization of the OCI images."
  echo "  --gh-org <org> - The organization of the GitHub repository."
  echo "  --gh-repo <repo> - The GitHub repository name."
  echo "  --dry-run - Do not create the release."
  echo "  --sync-operator-repository <repository> - The operator repository to sync."
}

function parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
    --gh-org)
      GH_ORG="$2"
      shift
      ;;
    --gh-repo)
      GH_REPO="$2"
      shift
      ;;
    --oci-org)
      OCI_ORG="$2"
      shift
      ;;
    --dry-run)
      DRY_RUN="true"
      ;;
    --sync-operator-repository)
      SYNC_OPERATOR_REPOSITORY="$2"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 1
      ;;
    esac
    shift
  done
}

function strip_prefix() {
  local str="$1"
  local prefix="$2"

  echo ${str#"$prefix"}
}

function version_without_v() {
  strip_prefix "$1" v
}

function version_with_v() {
  local without_v=$(version_without_v "$1")

  echo "v$without_v"
}

# get_noobaa_version returns the NooBaa version by reading the `cmd/version/main.go`
#
# The function can be called without any arguments in which case it will return
# noobaa version without "v" prefixed to the version however if ANY second
# argument is provided to the function then it will prefix "v" to the version.
#
# Example: get_noobaa_version # returns version without "v" prefix
# Example: get_noobaa_version 1 # returns version with "v" prefix
function get_noobaa_version() {
  local version=$(go run cmd/version/main.go)
  if [[ $# -gte 1 ]]; then
    version_with_v "$version"
  else
    version_without_v "$version"
  fi
}

# bump_semver_patch takes in a semver and bumps the patch version
function bump_semver_patch() {
  local version=$(version_without_v "$1")
  version=$(echo ${version} | awk -F. -v OFS=. '{$NF = $NF+1 ; print}')
  echo "$version"
}

function create_noobaa_image() {
  echo "Creating noobaa image"
  make noobaa

  echo "Tagging noobaa image"
  docker tag noobaa ${OCI_ORG}/noobaa-core:$(get_noobaa_version)
}

function create_oci_release() {
  # Release OCI images to docker and quay.io
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "DRY_RUN is set, skipping OCI release creation."
    return
  fi

  local quay_image="quay.io/$QUAY_USERNAME/noobaa-core:$(get_noobaa_version)"
  local docker_image="$DOCKERHUB_USERNAME/noobaa-core:$(get_noobaa_version)"

  echo "Tagging the images..."
  docker tag "$OCI_ORG/noobaa-core:$(get_noobaa_version)" $quay_image
  docker tag "$OCI_ORG/noobaa-core:$(get_noobaa_version)" $docker_image

  echo "Logging in to docker.io..."
  echo "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USERNAME" --password-stdin

  echo "Pushing the images to docker.io..."
  docker push $docker_image

  echo "Logging in to quay.io..."
  echo "$QUAY_TOKEN" | docker login -u "$QUAY_USERNAME" --password-stdin quay.io

  echo "Pushing the images to quay.io..."
  docker push $quay_image
}

function sync_operator() {
  if [[ -z "$SYNC_OPERATOR_REPOSITORY" ]]; then
    echo "Skip Syncing operator, no repository was provided."
    return
  fi

  gh workflow run releaser.yaml -R "$GH_ORG/$SYNC_OPERATOR_REPOSITORY" -f base_branch="$BASE_BRANCH"
}

function update_package_json() {
  local version=$(bump_semver_patch $(get_noobaa_version))
  npm version ${version} --no-git-tag-version

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "DRY_RUN is set, skipping version bump."
    return
  fi

  git add .
  git commit -m "Automated commit to update README for version: ${version}"
  git push
}

function init() {
  check_environment_variables
  parse_args "$@"
}

function main() {
  create_noobaa_image
  create_oci_release
  sync_operator
  update_package_json
}

init "$@"
main
