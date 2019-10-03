#!/bin/bash

# Copyright (C) 2016 NooBaa
export PS4='\e[36m+ ${FUNCNAME:-main}\e[0m@\e[32m${BASH_SOURCE}:\e[35m${LINENO} \e[0m'

SCRIPT_NAME=$(basename $0)
K8S_CLIENT='kubectl'
STATEFULSET=noobaa-core
POD=$STATEFULSET-0
CONTAINER=core
WEB_DEBUG_PORT=9220
BG_DEBUG_PORT=9221
HOSTED_AGENTS_DEBUG_PORT=9222
ENDPOINT_DEBUG_PORT=9223

function usage {
    set +x
    echo -e "Usage:\n\t${SCRIPT_NAME} <service> [<service> ...] [options]"
    echo
    echo -e "Restart the NooBaa core pod, starting the specified NodeJS processes with the \"--inspect\" mode flag."
    echo -e "The command will also forward the opened debug ports to the local machine allowing to attach a local NodeJS"
    echo -e "debugger to the remote process). Exiting the process (using Ctrl + C) will revert the operation"
    echo
    echo "Services:"
    echo "  web               - The NooBaa web server NodeJS process (debug port ${WEB_DEBUG_PORT})"
    echo "  bg                - The NooBaa background workers NodeJS process (debug port ${BG_DEBUG_PORT})"
    echo "  hosted_agents     - The NooBaa hosted agents NodeJS process (debug port ${HOSTED_AGENTS_DEBUG_PORT})"
    echo "  endpoint/s3       - The NooBaa endpoint server NodeJS process (debug port ${ENDPOINT_DEBUG_PORT})"
    echo "  all               - All Noobaa NodeJS porcesses"
    echo
    echo "Options:"
    echo "  -n | --namespace  - The namespace used to locate the noobaa core pod, will use the current context if not specified"
    echo "  -c | --client     - The name of the kubernetes client to use"
    echo "  -d | --debug      - Print the underlaying kubernetes client commands and output"
    echo "  -h | --help       - Will show this help"
    echo
    exit 0
}

function k8s_client {
    if [ -z "$DEBUG" ]
    then
        ${K8S_CLIENT} "$@" -n ${NAMESPACE} &> /dev/null
    else
        echo "${K8S_CLIENT} "$@" -n ${NAMESPACE}"
        ${K8S_CLIENT} "$@" -n ${NAMESPACE}
    fi
}

function check_deps {
    ${K8S_CLIENT} &> /dev/null
    if [ $? -ne "0" ]
    then
        echo "⚠️  This tool is dependent on kubectl compliant kubernetes client, please install a kubectl (or a compliant client like oc) and try again"
        exit 1;
    fi
}

function process_args {
    if [ -z "${NAMESPACE}" ]
    then
        NAMESPACE=$(${K8S_CLIENT} config view --minify --output 'jsonpath={..namespace}')
    fi

    if [ -z "$DEBUG_WEB" ] && [ -z "$DEBUG_BG" ] && [ -z "$DEBUG_HOSTED_AGENTS" ] && [ -z DEBUG_ENDPOINT ]
    then
        usage;
    fi
}

function print_config {
    echo "⚙️  Using Kubernetes client: ${K8S_CLIENT}"
    echo "⚙️  Using namespace/project: ${NAMESPACE}"
}

function patch {
    local WEB_NODE_OPTIONS=""
    local BG_NODE_OPTIONS=""
    local HOSTED_AGENTS_NODE_OPTIONS=""
    local ENDPOINT_NODE_OPTIONS=""

    [ "$DEBUG_WEB" = true ] && WEB_NODE_OPTIONS="--inspect=${WEB_DEBUG_PORT}"
    [ "$DEBUG_BG" = true ] && BG_NODE_OPTIONS="--inspect=${BG_DEBUG_PORT}"
    [ "$DEBUG_HOSTED_AGENTS" = true ] && HOSTED_AGENTS_NODE_OPTIONS="--inspect=${HOSTED_AGENTS_DEBUG_PORT}"
    [ "$DEBUG_ENDPOINT" = true ] && ENDPOINT_NODE_OPTIONS="--inspect=${ENDPOINT_DEBUG_PORT}"

    k8s_client patch statefulset ${STATEFULSET} --patch '{
        "spec": {
            "template": {
                "spec": {
                    "containers": [
                        {
                            "name": "'${CONTAINER}'",
                            "env": [
                                {
                                    "name": "WEB_NODE_OPTIONS",
                                    "value": "'${WEB_NODE_OPTIONS}'"
                                },
                                {
                                    "name": "BG_NODE_OPTIONS",
                                    "value": "'${BG_NODE_OPTIONS}'"
                                },
                                {
                                    "name": "HOSTED_AGENTS_NODE_OPTIONS",
                                    "value": "'${HOSTED_AGENTS_NODE_OPTIONS}'"
                                },
                                {
                                    "name": "ENDPOINT_NODE_OPTIONS",
                                    "value": "'${ENDPOINT_NODE_OPTIONS}'"
                                }
                            ]
                        }
                    ]
                }
            }
        }
    }'
}

function start_debugger {
    echo "🔧 Patching statefulset ${STATEFULSET} to start NodeJS processes in debug mode (using the --inspect flag)"
    patch
    wait_for_pod_restart
}

function stop_debugger {
    DEBUG_WEB=""
    DEBUG_BG=""
    DEBUG_HOSTED_AGENTS=""
    DEBUG_ENDPOINT=""

    echo
    echo "🔧 Patching statefulset ${STATEFULSET} to start NodeJS processes normally"
    patch
    wait_for_pod_restart
    exit 0
}

function forward_port() {
    local PORTS=""

    echo "📡 Forwarding pod ${POD} debugger ports to local machine";
    if [ "$DEBUG_WEB" = true ]
    then
        echo "👂 Web server debug port: ${WEB_DEBUG_PORT}"
        PORTS=${PORTS}" ${WEB_DEBUG_PORT}:${WEB_DEBUG_PORT}"
    fi


    if [ "$DEBUG_BG" = true ]
    then
        echo "👂 Background workers debug port: ${BG_DEBUG_PORT}"
        PORTS=${PORTS}" ${BG_DEBUG_PORT}:${BG_DEBUG_PORT}"
    fi

    if [ "$DEBUG_HOSTED_AGENTS" = true ]
    then
        echo "👂 Hosted agents debug port: ${HOSTED_AGENTS_DEBUG_PORT}"
        PORTS=${PORTS}" ${HOSTED_AGENTS_DEBUG_PORT}:${HOSTED_AGENTS_DEBUG_PORT}"
    fi

    if [ "$DEBUG_ENDPOINT" = true ]
    then
        echo "👂 Endpoint/S3 server debug port: ${ENDPOINT_DEBUG_PORT}"
        PORTS=${PORTS}" ${ENDPOINT_DEBUG_PORT}:${ENDPOINT_DEBUG_PORT}"
    fi

    echo "ℹ️  Attach your debugger to the above ports on your local machine to start debugging"
    echo "ℹ️  Use ^C (Ctrl + C) once to stop the debugger (and the port forwarding) and revert the pod to normal state"

    k8s_client port-forward ${POD} ${PORTS}
}

function wait_for_pod_restart {
    echo "⏳ Waiting for pod ${POD} to terminate...";
    sleep 5s
    k8s_client wait pod ${POD} --for delete --timeout 600s
    echo "✅ Pod ${POD} terminated";

    echo "⏳ Waiting for pod ${POD} to start...";
    sleep 5s
    k8s_client wait pod ${POD} --for condition=ready --timeout 600s
    echo "✅ Pod ${POD} to started successfully";
}

while true
do
    case ${1} in
        web)            DEBUG_WEB=true
                        shift 1;;
        bg)             DEBUG_BG=true
                        shift 1;;
        hosted_agents)  DEBUG_HOSTED_AGENTS=true
                        shift 1;;
        endpoint)       DEBUG_ENDPOINT=true
                        shift 1;;
        s3)             DEBUG_ENDPOINT=true
                        shift 1;;
        all)            DEBUG_WEB=true;
                        DEBUG_BG=true;
                        DEBUG_HOSTED_AGENTS=true;
                        DEBUG_ENDPOINT=true;
                        shift 1;;
        -n|--namespace) NAMESPACE=${2}
                        shift 2;;
        -c|--client)    K8S_CLIENT=${2}
                        shift 2;;
        -d|--debug)     DEBUG=true;
                        shift 1;;
        -h|--help)      usage;;
        *)              usage;;
    esac

    if [ -z ${1} ]; then
        break
    fi
done

check_deps
process_args
print_config
trap stop_debugger 1 2
start_debugger
forward_port

