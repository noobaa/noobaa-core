#!/bin/bash
set -x

OPTIONS=$( getopt -o 'g:' --long "GIT_COMMIT:" -- "$@" )
eval set -- "${OPTIONS}"

while true
do
    case ${1} in
		-g|--GIT_COMMIT)    GIT_COMMIT=${2}
                            shift 2 ;;
		--)			        shift 1;
					        break ;;
    esac
done

: '
cp build/linux/* ./

if [ $(ls noobaa-setup* | wc -l) -ne 2 ]
then
    echo "There should be only two 'noobaa-setup' files, one is the setup and one md5, exiting"
    exit 1
else
    rm -rf ./noobaa-setup*.md5 
    mv ./noobaa-setup* ./noobaa-setup
fi
'

dockerfile="Tests.Dockerfile"

cp ./src/deploy/NVA_build/${dockerfile} ./

name="nbtests"
name_and_tag="${name}:${GIT_COMMIT}"
echo "Building: podman build -f ./${dockerfile} -t ${name_and_tag} --rm ./"
podman build --no-cache -f ./${dockerfile} -t ${name_and_tag} --rm ./ || exit 1
echo "Tagging: podman tag localhost/${name_and_tag} noobaaimages.azurecr.io/noobaa/${name_and_tag}"
podman tag localhost/${name_and_tag} noobaaimages.azurecr.io/noobaa/${name_and_tag}
echo "Pushing: podman push noobaaimages.azurecr.io/noobaa/${name_and_tag}"
podman push noobaaimages.azurecr.io/noobaa/${name_and_tag}
echo "Delete the latest hash image"
while read REPOSITORY TAG IMAGE_ID x 
do
    if [ ${REPOSITORY} == "localhost/${name}" ]
    then
        echo "Deleting image with IMAGE ID: ${IMAGE_ID}"
        podman image rm -f ${IMAGE_ID}
        break
    fi
done < <(podman image ls)