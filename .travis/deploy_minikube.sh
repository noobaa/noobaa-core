#!/usr/bin/env bash

export PS4='\e[36m+ ${FUNCNAME:-main}@${BASH_SOURCE}:${LINENO} \e[0m'
# exit immediately when a command fails
set -e
# only exit with zero if all commands of the pipeline exit successfully
set -o pipefail
# error on unset variables
set -u
# print each command before executing it
set -x

#
# NOTE: This script was originally copied from the Cojaeger-operator build
# https://github.com/jaegertracing/jaeger-operator/blob/master/.travis/setupMinikube.sh

export MINIKUBE_VERSION=v1.8.2
export KUBERNETES_VERSION=v1.23.12

source /etc/os-release

if [ "${ID}" == "ubuntu" ]
then 
    # socat is needed for port forwarding
    sudo apt-get update && sudo apt-get install socat && sudo apt-get install conntrack
    sudo mount --make-rshared /
    sudo mount --make-rshared /proc
    sudo mount --make-rshared /sys
elif [ "${ID}" == "centos" ]
then
    dnf install -y sudo
    sudo dnf -y update && sudo dnf -y install socat conntrack 
    dnf install -y dnf-plugins-core
    sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    sudo dnf install -y docker-ce docker-ce-cli containerd.io --nobest
    #disable SELinux
    SELinux_status=$(sestatus | grep "SELinux status" | awk -F ":" '{print $2}' | xargs )
    if [ "${SELinux_status}" == "enabled" ]
    then
        sudo setenforce 0
    fi
else
    echo "${ID} is not supported for ${0}, Exiting."
    exit 1
fi

curl -Lo kubectl https://storage.googleapis.com/kubernetes-release/release/${KUBERNETES_VERSION}/bin/linux/amd64/kubectl && \
    chmod +x kubectl &&  \
    #moving kubectl to /usr/bin/ and not /usr/local/bin/ because on Centos it fails to sudo from /usr/local/bin/
    # it fails to sudo from /usr/local/bin/ even if it is the ${PATH}
    sudo mv kubectl /usr/bin/

curl -Lo minikube https://storage.googleapis.com/minikube/releases/${MINIKUBE_VERSION}/minikube-linux-amd64 && \
    chmod +x minikube &&  \
    #moving minikube to /usr/bin/ and not /usr/local/bin/ because on Centos it fails to sudo from /usr/local/bin/
    # it fails to sudo from /usr/local/bin/ even if it is the ${PATH}
    sudo mv minikube /usr/bin/minikube

mkdir "${HOME}"/.kube || true
touch "${HOME}"/.kube/config

# minikube config
minikube config set WantUpdateNotification false
minikube config set WantNoneDriverWarning false
minikube config set vm-driver none

cat ~/.minikube/config/config.json

minikube version
#sudo minikube start --kubernetes-version=$KUBERNETES_VERSION #--insecure-registry="${LOCAL_IP}:5000" #TODO Remove insecure
sudo minikube start --kubernetes-version=$KUBERNETES_VERSION

current_user=$(whoami)
if [ "${current_user}" != "root"  ]
then
    sudo chown -R ${current_user}: /home/${current_user}/.minikube/
fi

minikube update-context

# Following is just to demo that the kubernetes cluster works.
kubectl cluster-info
# Wait for kube-dns to be ready.
JSONPATH='{range .items[*]}{@.metadata.name}:{range @.status.conditions[*]}{@.type}={@.status};{end}{end}'; until kubectl -n kube-system get pods -lk8s-app=kube-dns -o jsonpath="$JSONPATH" 2>&1 | grep -q "Ready=True"; do sleep 1;echo "waiting for kube-dns to be available"; kubectl get pods --all-namespaces; done
