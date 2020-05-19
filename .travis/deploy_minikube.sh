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

# socat is needed for port forwarding
sudo apt-get update && sudo apt-get install socat && sudo apt-get install conntrack

export MINIKUBE_VERSION=v1.8.2
export KUBERNETES_VERSION=v1.17.3

sudo mount --make-rshared /
sudo mount --make-rshared /proc
sudo mount --make-rshared /sys

curl -Lo kubectl https://storage.googleapis.com/kubernetes-release/release/${KUBERNETES_VERSION}/bin/linux/amd64/kubectl && \
    chmod +x kubectl &&  \
    sudo mv kubectl /usr/local/bin/

curl -Lo minikube https://storage.googleapis.com/minikube/releases/${MINIKUBE_VERSION}/minikube-linux-amd64 && \
    chmod +x minikube &&  \
    sudo mv minikube /usr/local/bin/minikube

mkdir "${HOME}"/.kube || true
touch "${HOME}"/.kube/config

# minikube config
minikube config set WantNoneDriverWarning false
minikube config set vm-driver none

minikube version
sudo minikube start --kubernetes-version=$KUBERNETES_VERSION #--insecure-registry="${LOCAL_IP}:5000" #TODO Remove insecure
sudo chown -R travis: /home/travis/.minikube/

minikube update-context

# Following is just to demo that the kubernetes cluster works.
kubectl cluster-info
# Wait for kube-dns to be ready.
JSONPATH='{range .items[*]}{@.metadata.name}:{range @.status.conditions[*]}{@.type}={@.status};{end}{end}'; until kubectl -n kube-system get pods -lk8s-app=kube-dns -o jsonpath="$JSONPATH" 2>&1 | grep -q "Ready=True"; do sleep 1;echo "waiting for kube-dns to be available"; kubectl get pods --all-namespaces; done
