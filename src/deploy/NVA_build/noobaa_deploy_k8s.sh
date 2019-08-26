#!/bin/bash

GREEN='\033[0;32m'
NC='\033[0m' # No Color

SCRIPT_NAME=$(basename $0)
EMAIL="admin@noobaa.io"
PASSWD=""
SYS_NAME=noobaa
NAMESPACE=$(kubectl config get-contexts | grep "\*" | awk '{print $5}')
NOOBAA_CORE_YAML=https://raw.githubusercontent.com/noobaa/noobaa-core/5.0/src/deploy/NVA_build/noobaa_core.yaml
CREDS_SECRET_NAME=noobaa-create-sys-creds
NOOBAA_SECRETS_NAME=noobaa-secrets
ACCESS_KEY=""
SECRET_KEY=""
COMMAND=NONE
NOOBAA_STATEFULSET_NAME=noobaa-server
NOOBAA_POD_NAME=${NOOBAA_STATEFULSET_NAME}-0
CLUSTER_NAME=$(kubectl config view --minify -o json | jq -r '.clusters[0].name')
NUM_AGENTS=3
PV_SIZE_GB=50
INSTALL_AGENTS=false
STORAGE_CLASS=""
NOOBAA_CONFIGMAP_NAME="noobaa-config-map"
NOOBAA_ACCOUNT_NAME="noobaa-account"

jq --version &> /dev/null
if [ $? -ne 0 ]; then
    echo "This script is dependent on jq json parser. https://stedolan.github.io/jq/"
    echo "Please install jq and try again"
    exit 1
fi

function usage(){
    set +x
    echo -e "Usage:\n\t${SCRIPT_NAME} [command] [options]"
    echo -e "\nDeploy NooBaa server in Kubernetes"
    echo -e "NooBaa will be installed using kubectl on the cluster currently connected to kubectl (you can view it using: kubectl config current-context)\n"
    echo "Commands:"
    echo "deploy            -   deploy NooBaa in a given namespace"
    echo "delete            -   delete an existing NooBaa deployment in a given namespace"
    echo "info              -   get NooBaa deployment details in a given namespace. noobaa credentials (email\password) are requires to get S3 access keys"
    echo "storage           -   provision kuberentes PVs to use as backend storage for objects. specify --size and --num-pvs to control the provisioned storage"
    echo
    echo "Options:"
    echo "-e --email        -   Custom email address to use for the NooBaa system owner account"
    echo "-n --namespace    -   The namespace to create NooBaa resources in. This namespace must already exist. using the current namespace by default"
    echo "-p --password     -   Login password to NooBaa management console (required to get S3 access keys)"
    echo "-f --file         -   Use a custom yaml file"
    echo "-s --sys-name     -   The system name in NooBaa management console. default is 'noobaa'"
    echo "--size            -   PV size in GB to use as backend storage to store objects. Notice that by default noobaa uses 3 replicas to store objects. default ${PV_SIZE_GB}GB"
    echo "--num-pvs         -   number of PVs to provisons as backend storage. Minimum value is 3. default is 3"
    echo "--class           -   storageClass to use for PVs"
    # echo "--pv              -   when deploying a new system also provision kubernetes PVs to use as backend storage for objects. default is false"
    echo "-h --help         -   Will show this help"
    exit 0
}

while true
do
    case ${1} in
        deploy)         COMMAND=DEPLOY
                        shift 1;;
        delete)         COMMAND=DELETE
                        shift 1;;
        info)           COMMAND=INFO
                        shift 1;;
        storage)        COMMAND=STORAGE
                        shift 1;;
        -e|--email)     EMAIL=${2}
                        shift 2;;
        -n|--namespace) NAMESPACE=${2}
                        shift 2;;
        -f|--file)      NOOBAA_CORE_YAML=${2}
                        shift 2;;
        -s|--sys-name)  SYS_NAME=${2}
                        shift 2;;
        -p|--password)  PASSWD=${2}
                        shift 2;;
        --size)         PV_SIZE_GB=${2}
                        shift 2;;
        --num-pvs)      NUM_AGENTS=${2}
                        shift 2;;
        --class)        STORAGE_CLASS=${2}
                        shift 2;;
        --pv)           INSTALL_AGENTS=true
                        shift 1;;
        -h|--help)	    usage;;
        *)              usage;;
    esac

    if [ -z ${1} ]; then
        break
    fi
done

if [ "${NAMESPACE}" == "" ]; then
    NAMESPACE=default
fi
KUBECTL="kubectl --namespace ${NAMESPACE}"

function error_and_exit {
    echo "Error: $1"
    exit 1
}


function deploy_noobaa {
    if [ "${EMAIL}" == "" ]; then
        error_and_exit "email is required for deploy command"
    fi


    #ensure namespace
    kubectl create namespace ${NAMESPACE} &> /dev/null

    #check if noobaa already exist
    ${KUBECTL} get pod ${NOOBAA_POD_NAME} 2> /dev/null | grep -q ${NOOBAA_POD_NAME}
    if [ $? -ne 1 ]; then
        error_and_exit "NooBaa is already deployed in the namespace '${NAMESPACE}'. delete it first or deploy in a different namespace"
    fi

    PASSWD=$(openssl rand -base64 10)
    echo -e "${GREEN}Creating NooBaa resources in namespace ${NAMESPACE}${NC}"

    # Pre apply actions
    create_cluster_bindings
    create_noobaa_secrets
    create_cred_secret
    create_config_map

    # apply noobaa_core.yaml in the cluster
    ${KUBECTL} apply -f ${NOOBAA_CORE_YAML}
    echo -e "\n${GREEN}Waiting for external IPs to be allocated for NooBaa services. this might take several minutes${NC}"
    sleep 2

    # Post apply actions
    get_all_ips
    set_oauth_redirect_uri
    print_noobaa_info

    # if [ "${INSTALL_AGENTS}" == "true" ]; then
    #     install_storage_agents
    # fi

}

function verify_noobaa_deployed {
    #make sure noobaa exist
    ${KUBECTL} get statefulset ${NOOBAA_STATEFULSET_NAME} 2> /dev/null | grep -q ${NOOBAA_STATEFULSET_NAME}
    if [ $? -ne 0 ]; then
        error_and_exit "NooBaa is not deployed in the namespace '${NAMESPACE}'. you can deploy using ${SCRIPT_NAME} deploy"
    fi
}


function install_storage_agents {
    # verify_noobaa_deployed
    echo -e "${GREEN}Deploying noobaa agents for storage. This operation will provision ${NUM_AGENTS} PVs of size ${PV_SIZE_GB} GB${NC}"
    get_all_ips
    get_auth_token

    # create a pool.to manage the storage.
    $(curl http://${ACCESS_IP_AND_PORT}/rpc/ -sd '{
        "api": "pool_api",
        "method": "create_hosts_pool",
        "params": {
            "name": pool-"'$(openssl rand -hex 4)'",
            "is_managed": true,
            "host_count": '${NUM_AGENTS}',
            "host_config": {
                "volume_size": '$((PV_SIZE_GB * (1024 ** 3)))'
            }
        },
        "auth_token": "'${TOKEN}'"
    }');
}

function get_all_ips {
    MGMT_IP=$(get_service_external_ip noobaa-mgmt)
    NODE_PORT_MGMT_FALLBACK=$(get_node_port_ip_and_port noobaa-mgmt)
    NODE_PORT_S3_FALLBACK=$(get_node_port_ip_and_port s3)

    ACCESS_IP_AND_PORT=${MGMT_IP}:8080
    if [ "${MGMT_IP}" == "" ]; then
        ACCESS_IP_AND_PORT=${NODE_PORT_MGMT_FALLBACK}
    fi
}

function print_noobaa_info {
    # if management external ip is not found assume there is no external ip and don't try find S3
    if [ "${MGMT_IP}" == "" ]; then
        get_access_keys
        echo -e "\n\n================================================================================"
        echo "Could not identify an external IP to connect from outside the cluster"
        echo "External IP is usually allocated automatically for Kubernetes clusters deployed on public cloud providers"
        echo "You can try again later to see if an external IP was allocated using '${SCRIPT_NAME} info'"
        echo
        echo "Node port based management URL: http://${NODE_PORT_MGMT_FALLBACK}"
        echo
        echo
        echo "      login email             : ${EMAIL}"
        echo "      login password          : ${PASSWD}"
        echo
        echo "The following for s3 : http://${NODE_PORT_S3_FALLBACK}"
        echo "Cluster internal S3 endpoint  : http://s3.${NAMESPACE}.svc.cluster.local:80 or"
        echo "                                https://s3.${NAMESPACE}.svc.cluster.local:443"
        echo "      S3 access key           : ${ACCESS_KEY}"
        echo "      S3 secret key           : ${SECRET_KEY}"
        echo -e "\nyou can view all NooBaa resources in kubernetes using the following command:"
        echo "      ${KUBECTL} get all --selector=app=noobaa"
        echo -e "================================================================================\n"
    else
        S3_IP=$(get_service_external_ip s3)
        get_access_keys
        # if [[ "${NODE_PORT_MGMT_FALLBACK}" == *"mini"* ]]; then
        #    get_access_keys ${NODE_PORT_MGMT_FALLBACK}
        # else
        #    get_access_keys ${MGMT_IP}:8080
        # fi
        echo -e "\n\n================================================================================"
        echo "External management console   : http://${MGMT_IP}:8080 or "
        echo "                                https://${MGMT_IP}:8443"
        echo "nodePort access for management: http://${NODE_PORT_MGMT_FALLBACK}"
        echo
        echo "      login email             : ${EMAIL}"
        echo "      initial password        : ${PASSWD}"
        echo
        echo "External S3 endpoint          : http://${S3_IP}:80 or "
        echo "                                https://${S3_IP}:443"
        echo "nodePort access for S3        : http://${NODE_PORT_S3_FALLBACK}"
        echo
        echo "Cluster internal S3 endpoint  : http://s3.${NAMESPACE}.svc.cluster.local:80 or"
        echo "                                https://s3.${NAMESPACE}.svc.cluster.local:443"
        echo "      S3 access key           : ${ACCESS_KEY}"
        echo "      S3 secret key           : ${SECRET_KEY}"
        echo -e "\nyou can view all NooBaa resources in kubernetes using the following command:"
        echo "      ${KUBECTL} get all --selector=app=noobaa"
        echo -e "================================================================================\n"
        echo "Please consider logging in to the management console and changing the initial password"
    fi

}


function delete_noobaa {
    echo "Deleting NooBaa resources in namespace ${NAMESPACE}"
    ${KUBECTL} delete secret ${TOKEN_SECRET_NAME}
    ${KUBECTL} delete secret ${CREDS_SECRET_NAME}
    ${KUBECTL} delete configmap ${NOOBAA_CONFIGMAP_NAME}
    ${KUBECTL} delete clusterrolebinding noobaa-auth-delegator-${NAMESPACE}
    ${KUBECTL} delete -f ${NOOBAA_CORE_YAML}
    ${KUBECTL} delete pvc datadir-${NOOBAA_POD_NAME}
    ${KUBECTL} delete pvc logdir-${NOOBAA_POD_NAME}
    ${KUBECTL} delete pvc mongo-datadir-${NOOBAA_POD_NAME}
    ${KUBECTL} delete statefulset -l noobaa-module=noobaa-pool-impl # delete noobaa pool's stateful sets
    ${KUBECTL} delete pvc -l noobaa-module=noobaa-agent # delete noobaa agents volumes
}


function get_service_external_ip {
    if [ "${CLUSTER_NAME}" != "minikube" ] && [ "${CLUSTER_NAME}" != "minishift" ]; then
        local IP=$(${KUBECTL} get service $1 -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
        local HOST_NAME=$(${KUBECTL} get service $1 -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
        local EXTERNAL_IP=$(${KUBECTL} get service $1 -o jsonpath='{.spec.externalIPs[0]}')
        local RETRIES=0
        local MAX_RETRIES=60
        while [ "${IP}" == "" ] && [ "${HOST_NAME}" == "" ] && [ "${EXTERNAL_IP}" == "" ]; do
            RETRIES=$((RETRIES+1))
            if [ $RETRIES -gt $MAX_RETRIES ]; then
                return 1
            fi
            sleep 5
            IP=$(${KUBECTL} get service $1 -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
            HOST_NAME=$(${KUBECTL} get service $1 -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
            EXTERNAL_IP=$(${KUBECTL} get service $1 -o jsonpath='{.spec.externalIPs[0]}')
        done

        if [ "${IP}" != "" ]; then
            echo ${IP}
        elif [ "${HOST_NAME}" != "" ]; then
            echo ${HOST_NAME}
        elif [ "${EXTERNAL_IP}" != "" ]; then
            echo ${EXTERNAL_IP}
        fi
    fi
}


function get_node_port_ip_and_port {
    local NODE_PORT=$(${KUBECTL} get service $1 -o jsonpath='{.spec.ports[0].nodePort}')
    local HOST_NAME=$(${KUBECTL} get node -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
    if [ "${CLUSTER_NAME}" == "minikube" ]; then
        echo $(minikube ip):${NODE_PORT}
    elif [ "${CLUSTER_NAME}" == "minishift" ]; then
        echo  $(minishift ip):${NODE_PORT}
    else
       echo ${HOST_NAME}:${NODE_PORT}
    fi
}

function wait_for_noobaa_ready_with_timeout {
    local TIMEOUT=$1
    local RETRY_DELAY=10
    local TOTAL_WAIT=0
    while [ ${TOTAL_WAIT} -lt ${TIMEOUT} ]; do
        local READY=$(${KUBECTL} get pod ${NOOBAA_POD_NAME} -o json | jq -r '.status.containerStatuses[0].ready')
        if [ "${READY}" == "true" ]; then
            return 0
        fi
        sleep ${RETRY_DELAY}
        TOTAL_WAIT=$((TOTAL_WAIT+RETRY_DELAY))
    done
    echo -e "\nlooks like it takes too long for NooBaa pod to become ready"
    echo "run 'kubectl describe pod ${NOOBAA_POD_NAME}' to see if there are any errors"
    error_and_exit "if all looks good, once the pod '${NOOBAA_POD_NAME}' is ready you can run '${SCRIPT_NAME} info' to get system information"
}

function get_auth_token {
    wait_for_noobaa_ready_with_timeout 1200
    ${KUBECTL} get secret ${CREDS_SECRET_NAME} &> /dev/null
    if [ "$?" -ne 0 ]; then
        error_and_exit "could not find secret ${CREDS_SECRET_NAME} in namespace ${NAMESPACE}"
    fi
    EMAIL=$(${KUBECTL} get secret ${CREDS_SECRET_NAME} -o jsonpath='{.data.email}' | base64 --decode;printf "\n")
    PASSWD=$(${KUBECTL} get secret ${CREDS_SECRET_NAME} -o jsonpath='{.data.password}' | base64 --decode;printf "\n")
    SYS_NAME=$(${KUBECTL} get secret ${CREDS_SECRET_NAME} -o jsonpath='{.data.name}' | base64 --decode;printf "\n")
    TOKEN=$(${KUBECTL} get secret ${CREDS_SECRET_NAME} -o jsonpath='{.data.token}' | base64 --decode;printf "\n")
    if [ "${TOKEN}" == "" ]; then
        local MAX_RETRIES=50
        local RETRIES=0
        # repeat until access_keys are returned
        while [ "${TOKEN}" == "" ]; do
            if [ ${RETRIES} -gt ${MAX_RETRIES} ]; then
                echo "Could not get access token for noobaa"
                return 1
            else
                #get access token to the system
                TOKEN=$(curl http://${ACCESS_IP_AND_PORT}/rpc/ --max-time 20 -sd '{
                "api": "auth_api",
                "method": "create_auth",
                "params": {
                    "role": "admin",
                    "system": "'${SYS_NAME}'",
                    "email": "'${EMAIL}'",
                    "password": "'${PASSWD}'"
                }
                }' | jq -r '.reply.token')
                sleep 2
                RETRIES=$((RETRIES+1))
            fi
        done

        ${KUBECTL} delete secret  ${CREDS_SECRET_NAME}
        ${KUBECTL} create secret generic ${CREDS_SECRET_NAME} --from-literal=name=${SYS_NAME} --from-literal=email=${EMAIL} --from-literal=password=${PASSWD} --from-literal=token=${TOKEN}
    fi
}

function get_access_keys {
    echo -e "${GREEN}Getting S3 access keys from NooBaa system. Waiting for NooBaa to be ready${NC}"
    get_auth_token
    local MAX_RETRIES=50
    local RETRIES=0
    # repeat until access_keys are returned
    while [ "${ACCESS_KEY}" == "" ] || [ "${SECRET_KEY}" == "" ] || [ "${ACCESS_KEY}" == "null" ] || [ "${SECRET_KEY}" == "null" ]; do
        if [ ${RETRIES} -gt ${MAX_RETRIES} ]; then
            echo "Could not get S3 access keys from NooBaa system. Make sure the email and password are correct"
            ACCESS_KEY="***********"
            SECRET_KEY="***********"
            return 0
        else
            S3_ACCESS_KEYS=$(curl http://${ACCESS_IP_AND_PORT}/rpc/ --max-time 20 -sd '{
            "api": "account_api",
            "method": "read_account",
            "params": { "email": "'${EMAIL}'" },
            "auth_token": "'${TOKEN}'"
            }' | jq -r ".reply.access_keys[0]")
            ACCESS_KEY=$(echo ${S3_ACCESS_KEYS} | jq -r ".access_key")
            SECRET_KEY=$(echo ${S3_ACCESS_KEYS} | jq -r ".secret_key")
            sleep 2
            RETRIES=$((RETRIES+1))
        fi
    done
}

function create_cluster_bindings {
    ${KUBECTL} apply -f <(echo "
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: noobaa-auth-delegator-${NAMESPACE}
subjects:
  - kind: ServiceAccount
    namespace: ${NAMESPACE}
    name: noobaa-account
roleRef:
  kind: ClusterRole
  name: system:auth-delegator
  apiGroup: rbac.authorization.k8s.io
    ")
}

function create_cred_secret {
    ${KUBECTL} delete secret ${CREDS_SECRET_NAME} &> /dev/null
    ${KUBECTL} create secret generic ${CREDS_SECRET_NAME} \
        --from-literal=name=${SYS_NAME} \
        --from-literal=email=${EMAIL} \
        --from-literal=password=${PASSWD}
}

function create_noobaa_secrets {
    local SERVER_SECRET=$(openssl rand -hex 4)
    local JWT_SECRET=$(openssl rand -hex 20)
    ${KUBECTL} delete secret ${NOOBAA_SECRETS_NAME} &> /dev/null
    ${KUBECTL} create secret generic ${NOOBAA_SECRETS_NAME} \
        --from-literal=server_secret=${SERVER_SECRET} \
        --from-literal=jwt=${JWT_SECRET}
}

function create_config_map {
    local AGENT_IMAGE=$(${KUBECTL} apply -f ${NOOBAA_CORE_YAML} \
        --dry-run -o jsonpath='{.items[?(@.kind=="StatefulSet")].spec.template.spec.containers[0].image}')
    local OAUTH_INFO=$(${KUBECTL} get --raw '/.well-known/oauth-authorization-server')
    local OAUTH_AUTHORIZATION_ENDPOINT=$(echo ${OAUTH_INFO} | jq -r '.authorization_endpoint')
    local OAUTH_TOKEN_ENDPOINT=$(echo ${OAUTH_INFO} | jq -r '.token_endpoint')

    ${KUBECTL} delete configmap ${NOOBAA_CONFIGMAP_NAME} &> /dev/null
    ${KUBECTL} create configmap ${NOOBAA_CONFIGMAP_NAME} \
        --from-literal=noobaa_agent_profile="{\"image\": \"${AGENT_IMAGE}\"}" \
        --from-literal=oauth_authorization_endpoint=${OAUTH_AUTHORIZATION_ENDPOINT} \
        --from-literal=oauth_token_endpoint=${OAUTH_TOKEN_ENDPOINT}
}

function set_oauth_redirect_uri {
    local OAUTH_ANNOTATION_KEY=serviceaccounts.openshift.io/oauth-redirecturi.nbconsole
    local OAUTH_REDIRECT_URI=https://${MGMT_IP}:8443/fe/oauth/callback
    ${KUBECTL} annotate serviceaccount ${NOOBAA_ACCOUNT_NAME} ${OAUTH_ANNOTATION_KEY}=${OAUTH_REDIRECT_URI}
}

function get_info {
    echo -e "${GREEN}Collecting NooBaa services information. this might take some time${NC}"
    verify_noobaa_deployed
    get_all_ips
    print_noobaa_info
}

case ${COMMAND} in
    NONE)       usage;;
    DEPLOY)     deploy_noobaa;;
    DELETE)     delete_noobaa;;
    STORAGE)    install_storage_agents;;
    INFO)       get_info;;
    *)          usage;;
esac

exit 0
