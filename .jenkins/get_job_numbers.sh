#!/bin/bash

export PS4='\e[36m+ ${FUNCNAME:-main}@${BASH_SOURCE}:${LINENO} \e[0m'
set -e -o pipefail

function usage() {
    echo "Options:"
    echo "--currentBuild            specify the current build number"
    echo "--JENKINS_URL             specify the jenkins base url"
    echo "--help|-h                 specify the flags"
    echo "--jobName                 specify the job name"
    echo " "
    exit 0
}

ARGUMENT_LIST=(
    "currentBuild"
    "JENKINS_URL"
    "jobName"
)

opts=$(getopt \
    --longoptions "$(printf "%s:," "${ARGUMENT_LIST[@]}")help" \
    --name "$(basename "${0}")" \
    --options "" \
    -- "$@"
)
rc=$?

if [ ${rc} -ne 0 ]
then
    echo "Try '--help' for more information."
    exit 1
fi

eval set -- "${opts}"

while true; do
    case "${1}" in
        --currentBuild) currentBuild=${2}
                        shift 2 ;;
        --JENKINS_URL)  JENKINS_URL=${2}
                        shift 2 ;;
        --jobName)      jobName=${2}
                        shift 2 ;;
        --help)         usage ;;
        --)             shift 1
                        break ;;
    esac
done

function get_pr_number() {
    local url=${1}
    curl -L ${url}/api/xml > /tmp/job.xml
    pr_number=$(cat /tmp/job.xml | awk -F "<value>/origin" '{print $2}' | awk -F "</value>" '{print $1}' | awk -F "/" '{print $3}')
    echo ${pr_number}
}

function check_if_previous_job() {
    local url=${1}
    local currentBuild=${2}
    #It will not work if there are digits in the url other then the job number.
    if [ "${url//[!0-9]/}" -lt "${currentBuild}" ]
    then
        return 0
    fi
    return 1
}

set -x

current_job_pr_number=$(get_pr_number "${JENKINS_URL}/job/${jobName}/${currentBuild}")

running_jobs_xml="/tmp/running.xml"
wget -O ${running_jobs_xml} "${JENKINS_URL}/computer/api/xml?tree=computer[executors[currentExecutable[*]],oneOffExecutors[currentExecutable[*]]]"

while read url
do
    if check_if_previous_job ${url} ${currentBuild}
    then
        pr_number=$(get_pr_number "${url}")
        if [ ${pr_number} == ${current_job_pr_number} ]
        then
            #It will not work if there are digits in the url other then the job number.
            jobs_to_terminate+=" ${url//[!0-9]/}"
        fi
    fi
done < <(cat ${running_jobs_xml} | grep -oPm1 '(?<=<url>)[^<]+' | grep ${jobName})

jobs_to_terminate=($(printf "%s\n" ${jobs_to_terminate[@]} | sort | uniq))

rm -rf ${running_jobs_xml} /tmp/job.xml

echo ${jobs_to_terminate[@]}
