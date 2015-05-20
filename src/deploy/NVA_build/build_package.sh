#!/bin/bash

#Globals
G_USER="noobaa-dep"
G_TOK="92a46eb3c399aaafb250a04633a9c3ee64f2396d"

#Return next version according to
#current = X.Y.Z , increment = X2.Y2.Z2, new = X+X2.Y+Y2.Z+Z2
#output param $3
function get_next_version {
  #Getting latest release from GitHub
  local tmp_release=`curl -u ${G_USER}:${G_TOK} https://api.github.com/repos/noobaa/noobaa-core/releases/latest | `
  local current=`echo $tmp_release | sed 's:.*tag_name"\: "v\(.*\)", "target_com.*:\1:'`
  local increment=${VER_INCREMENT}

  local cur_array=(${current//./ })
  local inc_array=(${increment//./ })

  #turn current version into full X.Y.Z notation
  if [ ${#inc_array[@]} -eq 1 ]; then
          inc_array[1]=0
          inc_array[2]=0
  elif [ ${#inc_array[@]} -eq 2 ]; then
          inc_array[2]=0
  fi

  #turn increment version into full X.Y.Z notation
  if [ ${#cur_array[@]} -eq 1 ]; then
          cur_array[1]=0
          cur_array[2]=0
  elif [ ${#cur_array[@]} -eq 2 ]; then
          cur_array[2]=0
  fi

  #add versions
  local new="$((cur_array[0]+inc_array[0])).$((cur_array[1]+inc_array[1])).$((cur_array[2]+inc_array[2]))"
  eval "$3=$new"
}

function build_package() {
  #Clone repo accordig to commit hash, npm install and build package
  cd /git
  git clone https://${G_USER}:${G_TOK}@github.com/noobaa/noobaa-core.git
  git checkout ${COMMIT}
  cd /git/noobaa-core
  npm install
  gulp NVA_build
}

function publish_package() {
  local newver=$1
  aws s3 cp /git/noobaa-core/build/public/noobaa-NVA.tar.gz s3://noobaa-download/on_premise/v_${newver}
}

function release() {
  local version=$1
  API_JSON=$(printf '{"tag_name": "v%s","target_commitish": "master","name": "v%s","body": "New Release","draft": false,"prerelease": false}' $version $version)
  curl --data "$API_JSON" -u ${G_USER}:${G_TOK} https://api.github.com/repos/noobaa/noobaa-core/releases
}

function cleanup() {

}

if [ "$1" == "" ]; then
  echo "No commit hash"
  exit 1;
fi

COMMIT=$1
VER_INCREMENT="0.1"

if [ "$2" != "" ]; then
  VER_INCREMENT=$2
else
  VER_INCREMENT="0.0.1"
fi

next_version=""
get_next_version $CURRENT_RELEASE $VER_INCREMENT next_version #get next version
build_package           #build package
publish_package         #publish package to S3
release ${next_version} #create release in github
cleanup ${next_version}  #cleanup leftovers
