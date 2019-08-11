#!/bin/bash

SCRIPT_NAME=$(basename $0)
JOB_YAML="./test_job.yaml"

function usage(){
    set +x
    echo -e "Usage:\n\t${SCRIPT_NAME} <--name> <--image> <--tester_image> [--job_yaml yaml.file | --tests_list list.file | --wait]"
    echo -e "\nRun NooBaa system tests job"
    echo "Parameters:"
    echo "--name            -   The name of the test run. will be prefixed to all namespaces created by the test job"
    echo "--image           -   The image to test"
    echo "--tester_image    -   The tester image to use"
    echo "--job_yaml        -   The job yaml file, default is ${JOB_YAML}"
	echo "--tests_list      -   The test list (.js)"
    echo "--wait            -   Should wait for job completion, default is false"
    echo "-h --help         -   Will show this help"
    exit 1
}

echo "Running with: $@"
while true
do
    case ${1} in
        --name)         TEST_RUN_NAME=${2}
                        shift 2;;
        --image)        IMAGE=${2}
                        shift 2;;
        --tester_image) TESTER_IMAGE=${2}
                        shift 2;;
        --job_yaml)     JOB_YAML=${2}
                        shift 2;;
		--tests_list)   TESTS_LIST=${2}
						shift 2;;
        --wait)         WAIT_COMPLETION=true
                        shift 2;;
        -h|--help)	    usage;;
        *)              usage;;
    esac

    if [ -z ${1} ]; then
        break
    fi
done

if [ -z "${TEST_RUN_NAME}" ] || [ -z "${IMAGE}" ] || [ -z "${TESTER_IMAGE}" ] ; then
    usage
fi

echo "Creating namespace noobaa-tests"
kubectl create namespace noobaa-tests 

echo "Deploying test account and role"
kubectl -n noobaa-tests apply -f ./test_account.yaml


echo "inspecting"
docker inspect ${TESTER_IMAGE}

echo "Running test job ${TEST_RUN_NAME}"
sed -e "s~NOOBAA_IMAGE_PLACEHOLDER~${IMAGE}~" \
-e "s~TESTER_IMAGE_PLACEHOLDER~${TESTER_IMAGE}~" \
-e "s~TEST_JOB_NAME_PLACEHOLDER~${TEST_RUN_NAME}~" \
-e "s~NAMESPACE_PREFIX_PLACEHOLDER~${TEST_RUN_NAME}~" \
-e "s~TESTS_LIST_PLACEHOLDER~${TESTS_LIST}~" \
${JOB_YAML} \
| kubectl -n noobaa-tests apply -f -

#Wait for completion of job
sleep 10
kubectl get pods -n noobaa-tests -o yaml
pod=$(kubectl get pods -n noobaa-tests | tail -1 | awk '{print $1}' | cut -f 2 -d'-')

kubectl describe pods -n noobaa-tests

kubectl describe jobs -n noobaa-tests

if [ ${WAIT_COMPLETION} ]; then
    kubectl wait --for=condition=complete job/${TEST_RUN_NAME} -n noobaa-tests
fi

#Display logs of run
kubectl logs ${TEST_RUN_NAME}-${pod} -n noobaa-tests
