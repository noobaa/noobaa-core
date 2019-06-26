#!/bin/bash
set -x
#podman build -f ./src/deploy/NVA_build/Server.Dockerfile -t nbimage --rm ./ || exit 1

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

cp build/public/*noarch.rpm ./
if [ $(ls *.rpm | wc -l) -ne 1 ]
then
    echo "There should be only one rpm file, exiting"
    exit 1
else
    rpm_file=$(ls *.rpm)
    mv ./${rpm_file} ./noobaa.rpm
fi

script="set_mongo_repo.sh"
dockerfile="Server.Dockerfile"

cp ./src/deploy/rpm/${script} ./
cp ./src/deploy/NVA_build/${dockerfile} ./

name="nbserver"
name_and_tag="${name}:${GIT_COMMIT}"
echo "Building: podman build --build-arg noobaa_rpm=./noobaa.rpm --build-arg install_script=./${script} -f ./${dockerfile} -t ${name_and_tag} --rm ./"
podman build --no-cache --build-arg noobaa_rpm=./noobaa.rpm --build-arg install_script=./${script} -f ./${dockerfile} -t ${name_and_tag} --rm ./ || exit 1
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