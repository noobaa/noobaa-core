#!/bin/bash
set -x

export PS4='\e[36m+ ${FUNCNAME:-main}\e[0m@\e[32m${BASH_SOURCE}:\e[35m${LINENO} \e[0m'

SCRIPT_NAME=$(basename $0)
JOB_YAML="./test_job.yaml"
NAMESPACE="noobaa-tests"
TESTS_LIST="./pipeline_tests_list.js"
TESTS_CONCURRENCY="1"
TESTS_DELETE_ON_FAIL="DELETE_ON_FAIL_PLACEHOLDER"

function usage(){
    set +x
    echo -e "Usage:\n\t${SCRIPT_NAME} <--name> <--image> <--tester_image> [--job_yaml yaml.file | --tests_list list.file | --wait]"
    echo -e "\nRun NooBaa system tests job"
    echo "Parameters:"
    echo "--name            -   The name of the test run. will be prefixed to all namespaces created by the test job"
    echo "--image           -   The image to test"
    echo "--tester_image    -   The tester image to use"
    echo "--job_yaml        -   The job yaml file, (default: ./test_job.yaml)"
	echo "--tests_list      -   The test list (.js) (default: ./pipeline_tests_list.js)"
    echo "--concurrency     -   Set the number of test that runs in parallel (default: 1)"
    echo "--delete_on_fail  -   When set, will check if the test has failed. if so skip it's deletion"   
    echo "--wait            -   Should wait for job completion, (default: false)"
    echo "-h --help         -   Will show this help"
    exit 1
}

echo "Running with: $@"
while true
do
    case ${1} in
        --name)             TEST_RUN_NAME=${2}
                            shift 2;;
        --image)            IMAGE=${2}
                            shift 2;;
        --tester_image)     TESTER_IMAGE=${2}
                            shift 2;;
        --job_yaml)         JOB_YAML=${2}
                            shift 2;;
		--tests_list)       TESTS_LIST=${2}
						    shift 2;;
        --concurrency)      TESTS_CONCURRENCY=${2}
                            shift 2;;
        --wait)             WAIT_COMPLETION=true
                            shift 1;;
        --delete_on_fail)   TESTS_DELETE_ON_FAIL="delete_on_fail"
                            shift 1;;
        -h|--help)          usage;;
        *)                  usage;;
    esac

    if [ -z ${1} ]; then
        break
    fi
done

if [ -z "${TEST_RUN_NAME}" ] || [ -z "${IMAGE}" ] || [ -z "${TESTER_IMAGE}" ] ; then
    usage
fi

if [ ! -f "${TESTS_LIST}" ]
then
    echo -e "\n❌  Missing tests list: ${TESTS_LIST}"
    usage
elif [ ! -f "${JOB_YAML}" ]
then
    echo -e "\n❌  Missing job yaml ${JOB_YAML}"
    usage
fi

echo "Creating namespace ${NAMESPACE}"
kubectl create namespace ${NAMESPACE} 

echo "Deploying test account and role"
kubectl -n ${NAMESPACE} apply -f ./test_account.yaml

NAMESPACE_PREFIX=${TEST_RUN_NAME:0:7}

echo "Running test job ${TEST_RUN_NAME}"
sed -e "s~NOOBAA_IMAGE_PLACEHOLDER~${IMAGE}~" \
-e "s~TESTER_IMAGE_PLACEHOLDER~${TESTER_IMAGE}~" \
-e "s~TEST_JOB_NAME_PLACEHOLDER~${TEST_RUN_NAME}~" \
-e "s~NAMESPACE_PREFIX_PLACEHOLDER~${NAMESPACE_PREFIX}~" \
-e "s~TESTS_LIST_PLACEHOLDER~${TESTS_LIST}~" \
-e "s~TESTS_CONCURRENCY_PLACEHOLDER~${TESTS_CONCURRENCY}~" \
-e "s~DELETE_ON_FAIL_PLACEHOLDER~${TESTS_DELETE_ON_FAIL}~" \
${JOB_YAML} \
| kubectl -n ${NAMESPACE} apply -f -

#Wait for completion of job
sleep 10
pod=$(kubectl get pods -n ${NAMESPACE} | tail -1 | awk '{print $1}' | cut -f 2 -d'-')
server_namespace=$(kubectl get ns -o name | grep namespace/$NAMESPACE_PREFIX | cut -d/ -f2-)

if [ ${WAIT_COMPLETION} ]; then
    kubectl wait --for=condition=complete job/${TEST_RUN_NAME} --timeout=500s -n ${NAMESPACE}
    test_exit_code=$?
    #Display logs of run

    { echo ""; echo "LIST PODS:"; echo ""; } 2>/dev/null
    { echo "--------------------------------------------------------------------------------"; } 2>/dev/null
    kubectl get pod -A
    { echo "--------------------------------------------------------------------------------"; } 2>/dev/null

    { echo ""; echo "DUMP LOGS OF TEST JOB:"; echo ""; } 2>/dev/null
    { echo "--------------------------------------------------------------------------------"; } 2>/dev/null
    kubectl logs -n ${NAMESPACE} --tail 10000 ${TEST_RUN_NAME}-${pod} 
    { echo "--------------------------------------------------------------------------------"; } 2>/dev/null

    { echo ""; echo "DUMP LOGS OF NOOBAA CORE:"; echo ""; } 2>/dev/null
    { echo "--------------------------------------------------------------------------------"; } 2>/dev/null
    kubectl logs -n ${server_namespace} --tail 10000 noobaa-server-0 -c noobaa-server
    { echo "--------------------------------------------------------------------------------"; } 2>/dev/null

    { echo ""; echo "DUMP LOGS OF NOOBAA ENDPOINT:"; echo ""; } 2>/dev/null
    { echo "--------------------------------------------------------------------------------"; } 2>/dev/null
    kubectl logs -n ${server_namespace} --tail 10000 noobaa-server-0 -c endpoint
    { echo "--------------------------------------------------------------------------------"; } 2>/dev/null

    exit "$test_exit_code"
fi
