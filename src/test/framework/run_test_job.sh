#!/bin/bash


SCRIPT_NAME=$(basename $0)

function usage(){
    set +x
    echo -e "Usage:\n\t${SCRIPT_NAME} [Parameters]"
    echo -e "\nAll parameters are mandatory"
    echo -e "\nRun NooBaa system tests job"
    echo "Parameters:"
    echo "--name            -   The name of the test run. will be prefixed to all namespaces created by the test job"
    echo "--server_image    -   The server image to test"
    echo "--agent_image     -   The agent image to use. Agent and server versions must be the same"
    echo "--tester_image    -   The tester image to use"
    echo "-h --help         -   Will show this help"
    exit 0
}



while true
do
    case ${1} in
        --name)         TEST_RUN_NAME=${2}
                        shift 2;;
        --server_image) SERVER_IMAGE=${2}
                        shift 2;;
        --agent_image)  AGENT_IMAGE=${2}
                        shift 2;;
        --tester_image) TESTER_IMAGE=${2}
                        shift 2;;
        -h|--help)	    usage;;
        *)              usage;;
    esac

    if [ -z ${1} ]; then
        break
    fi
done



if [ "${TEST_RUN_NAME}" == "" ] || [ "${SERVER_IMAGE}" == "" ]|| [ "${AGENT_IMAGE}" == "" ] || [ "${TESTER_IMAGE}" == "" ]; then
    usage
fi



echo "Creating namespace noobaa-tests"
kubectl create namespace noobaa-tests 

echo "Deploying test account and role"
kubectl -n noobaa-tests apply -f ./test_account.yaml

echo "Running test job ${TEST_RUN_NAME}"
sed -e "s~SERVER_IMAGE_PLACEHOLDER~${SERVER_IMAGE}~" \
-e "s~AGENT_IMAGE_PLACEHOLDER~${AGENT_IMAGE}~" \
-e "s~TESTER_IMAGE_PLACEHOLDER~${TESTER_IMAGE}~" \
-e "s~TEST_JOB_NAME_PLACEHOLDER~${TEST_RUN_NAME}~" \
-e "s~NAMESPACE_PREFIX_PLACEHOLDER~${TEST_RUN_NAME}~" \
./test_job.yaml \
| kubectl -n noobaa-tests apply -f -