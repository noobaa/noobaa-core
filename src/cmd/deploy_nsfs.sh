#!/bin/bash
set -e
### REQUIREMENTS ###
# 1. NooBaa system installed on minikube
# 2. kubectl cli installed
# 3. aws cli installed
# 4. noobaa cli installed

# the results of this installation are - 
# 1. Deployment of nsfs-local StorageClass, PV and PVC resources
# 2. 2 file system folders, one pre-created by this script and the other one created by NooBaa
# 3. NSFS namespace resource pointing to a PVC
# 4. NooBaa nsfs exported bucket (RPC) - export of pre existing file system directory
# 5. Allow All bucket policy applied to the exported bucket
# 6. NooBaa account containing nsfs configuration
# 7. NooBaa nsfs bucket (S3) - noobaa will create the file system directory during the request
# see - https://github.com/noobaa/noobaa-core/wiki/NSFS-on-Kubernetes

NSFS_RESOURCE_NAME="fs1"
EXPORTED_BUCKET_NAME="exported-bucket"
S3_BUCKET_NAME="nsfs-bucket-using-s3-client"
NSFS_ACCOUNT_NAME="nsfs-account@noobaa.io"

HELP="
Help:
    "deploy_nsfs" is a noobaa-core command that deploys different resources in order to use namespace FS feature.
    
    NSFS S3 bucket              Is a NooBaa NSFS bucket that its underlying folder doesn't exist prior to 
                                the bucket creation request, NooBaa will create it during the bucket creation process.
    
    NSFS Exported bucket (RPC)  Is a NooBaa NSFS bucket that its underlying folder exists prior to the bucket creation request,
                                NooBaa will check the folder's existence during the bucket creation process.
    
    Prerequisites -
        1. NooBaa system installed on minikube
        2. kubectl cli installed
        3. aws cli installed
        4. noobaa cli installed

    For more information refer to the noobaa docs, see - https://github.com/noobaa/noobaa-core/wiki/NSFS-on-Kubernetes

";

USAGE="
Usage:
    bash /path/to/deploy_nsfs.sh <deployment/cleanup>
";

ARGUMENTS="
Arguments:
    <deployment/cleanup>     NooBaa will deploy/cleanup a local storageclass, pvc, pv, nsfs namespacestore, 
                             RPC exported bucket, S3 bucket and an account for the S3 bucket
";


function print_usage() {
    echo -e "${HELP}";
    echo -e "${USAGE}";
    echo -e "${ARGUMENTS}";
    exit 1;
}


# print_headline recieves 2 args - headline and explain and prints them
function print_headline(){
    headline_len=$((${#1} + 20))
    printf '%0.s-' $(seq 1 $headline_len)
    echo -e "\n--------- $1 ---------";
    printf '%0.s-' $(seq 1 $headline_len)
    echo -e "\n$2\n";

}


# print_done prints done
function print_done(){
    echo -e "done\n";
}


# set_endpoint_url sets and prints ENDPOINT 
function set_endpoint_url(){
ENDPOINT='https://localhost:10443';
print_headline "S3 ENDPOINT" "NooBaa S3 endpoint is $ENDPOINT"
print_done
}


# start_portforward starts port forwarding s3 service
function start_portforward(){
print_headline "S3 SERVICE PORT FORWARD START" "Port forwarding the S3 service:"
kubectl port-forward service/s3 10443:443 &
print_done
}


# stop_portforward stops port forwarding s3 service
function stop_portforward(){
print_headline "S3 SERVICE PORT FORWARD STOP" "Stop port forwarding the S3 service:"
pkill -f "port-forward service/s3 10443:443";
print_done
}


# set_admin_credentials reads admin account, sets and prints admin_account_access_key and admin_account_secret_key
function set_admin_credentials(){
print_headline "ADMIN CREDENTIALS" ""
admin_account=$(noobaa api account_api read_account '{"email":"admin@noobaa.io"}' -o json);
admin_account_access_key=$(echo $admin_account | jq -r '.access_keys[0].access_key');
admin_account_secret_key=$(echo $admin_account | jq -r '.access_keys[0].secret_key');
echo "Admin Access Key to be used $admin_account_access_key";
echo "Admin Secret Key to be used $admin_account_secret_key";
print_done
}


# create_sc_pv_pvc creates nsfs storage class, nsfs pv, and nsfs pvc
function create_sc_pv_pvc(){
print_headline "NSFS RESOURCES" "Creating NSFS local storage class, PV and PVC"

# create nsfs storage class
echo -e "Creating NSFS local storage class:\n";

storage_class_yaml="
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
    name: nsfs-local
provisioner: kubernetes.io/no-provisioner
volumeBindingMode: WaitForFirstConsumer
";

echo "$storage_class_yaml" | kubectl apply -f -;

print_done

# create nsfs persistent volume
echo -e "Creating NSFS local persistent volume:\n";

pv_yaml="
apiVersion: v1
kind: PersistentVolume
metadata:
    name: nsfs-vol
spec:
    storageClassName: nsfs-local
    volumeMode: Filesystem
    persistentVolumeReclaimPolicy: Retain
    local:
        path: /nsfs/
    capacity:
        storage: 1Ti
    accessModes:
        - ReadWriteMany
    nodeAffinity:
        required:
            nodeSelectorTerms:
                - matchExpressions:
                    - key: kubernetes.io/os
                      operator: Exists
";
echo "$pv_yaml" | kubectl apply -f -;

print_done


# create nsfs persistent volume claim
echo -e "Creating NSFS local persistent volume claim:\n";

pvc_yaml="
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
    name: nsfs-vol
spec:
    storageClassName: nsfs-local
    resources:
        requests:
            storage: 1Ti
    accessModes:
        - ReadWriteMany
";
echo "$pvc_yaml" | kubectl apply -f -;
print_done;
}


# delete_sc_pv_pvc deletes the nsfs pv, pvc and storageclass
function delete_sc_pv_pvc(){
print_headline "NSFS RESOURCES DELETION" "Deleting NSFS local storage class:"
kubectl delete pv nsfs-vol --wait=false;
kubectl patch pv nsfs-vol --type json --patch='[ { "op": "remove", "path": "/metadata/finalizers" } ]'
kubectl delete pvc nsfs-vol --wait=false;
kubectl patch pvc nsfs-vol --type json --patch='[ { "op": "remove", "path": "/metadata/finalizers" } ]'
kubectl delete storageclass nsfs-local;
print_done
}


# minikube_export_dir_creation logins to minikube host and creates the file system path will be used 
function minikube_export_dir_creation(){
print_headline "MINIKBE DIR CREATION" "Creating nsfs/bucket-path/ dir and changing its permissions to 777:"
minikube ssh -- "sudo mkdir -p /nsfs/bucket-path/; sudo chmod -R 777 /nsfs/bucket-path/;";
print_done;
}


# minikube_export_dir_deletion- logins to minikube host and deleted the file system path used by the nsfs resource
function minikube_export_dir_deletion(){
print_headline "MINIKBE DIR DELETION" "Deleting nsfs/bucket-path/ dir:"
minikube ssh -- "sudo rmdir /nsfs/bucket-path/;";
print_done
}

# skip_already_exist_error- skips failures of non zero return code and already exist error message
function skip_already_exist_error(){
exit_status=$?
if [[ $exit_status -ne 0 ]]; then
    echo "$2 failed with $1";
    if [[ $1 == *"already exists"* ]] || [[ $1 == *"BucketAlreadyExist"* ]] || [[ $1 == *"BUCKET_ALREADY_OWNED_BY_YOU"* ]] || 
        [[ $1 == *"BucketAlreadyOwnedByYou"* ]] || [[ $1 == *"email address already registered"* ]];
    then
        echo "$2 failed with already exists error: skipping.";
    else 
        echo "$2: failed";
        exit 1;
    fi
fi
}

# create_namespace_resource - creates the noobaa nsfs namespacestore on top of the file system pvc
# both exported bucket and s3 bucket will be on top of this namespace resource
function create_namespace_resource(){
set +e
print_headline "NAMESPACE RESOURCE CREATION" "Creating nsfs namespacestore on top of a pvc:"
output=$(noobaa namespacestore create nsfs $NSFS_RESOURCE_NAME --pvc-name='nsfs-vol' 2>&1);
skip_already_exist_error "${output}" "create_namespace_resource"
print_done;
set -e
}


# delete_namespace_resource - deleted the nsfs namespacestore
function delete_namespace_resource(){
print_headline "NAMESPACE RESOURCE DELETION" "Deleting nsfs namespacestore on top of a pvc:"
noobaa namespacestore delete $NSFS_RESOURCE_NAME;
print_done
}


# wait_for_endpoint_pod_to_restart - waits for endpoint pod to be deleted and for a new endpoint pod to be ready
function wait_for_endpoint_pod_to_restart(){ 
print_headline "CHECK VOLUME ATTACHED AND WAIT FOR ENDPOINT TO RESTART" "If fs volume not attached to noobaa-endpoint pod - Waiting 300s for endpoint pod to restart after nsfs namespacestore creation (the pvc is mounted to the pod):"
volume_attached=$(kubectl get deployment/noobaa-endpoint -o jsonpath={'$.spec.template.spec.volumes[?(@.name == "'"nsfs-${NSFS_RESOURCE_NAME}"'")].name'});
if [[ "$volume_attached" == "" ]]; 
then 
echo "nsfs-${NSFS_RESOURCE_NAME} is not attached, waiting for endpoint pod to restart" 
kubectl wait --for=delete pod -l noobaa-s3 --timeout=300s;
kubectl wait --for=condition=ready pod -l noobaa-s3 --timeout=300s;
else
echo "nsfs-${NSFS_RESOURCE_NAME} is already attached, no need to wait for endpoint pod to restart" 
fi
print_done
}


# create_nsfs_exported_bucket - create the noobaa exported bucket on top of the nsfs namespacestore and specific bucket path
function create_nsfs_exported_bucket(){
set +e
print_headline "RPC NAMESPACE BUCKET CREATION" "Creating nsfs bucket on top of ${NSFS_RESOURCE_NAME} namespacestore:"
output=$(noobaa api bucket_api create_bucket '{
  "name": "'"${EXPORTED_BUCKET_NAME}"'",
  "namespace":{
    "write_resource": { "resource": "'"${NSFS_RESOURCE_NAME}"'", "path": "bucket-path/" },
    "read_resources": [ { "resource": "'"${NSFS_RESOURCE_NAME}"'", "path": "bucket-path/" }]
  }
}' 2>&1);
skip_already_exist_error "${output}" "create nsfs exported bucket (RPC)"
print_done
set -e
}


# delete_nsfs_exported_bucket - deleted the noobaa exported bucket
function delete_nsfs_exported_bucket(){
print_headline "EXPORTED NAMESPACE BUCKET DELETION" "Deleting nsfs bucket on top of ${NSFS_RESOURCE_NAME} namespacestore:"
echo -e "deleting objects:"
AWS_ACCESS_KEY_ID=$account_access_key AWS_SECRET_ACCESS_KEY=$account_secret_key aws --endpoint $ENDPOINT --no-verify-ssl s3 rm s3://$EXPORTED_BUCKET_NAME --recursive;
echo -e "\ndeleting bucket:"
noobaa api bucket_api delete_bucket '{
  "name": "'"${EXPORTED_BUCKET_NAME}"'"
}';
print_done
}


# create_and_apply_bucket_policy- put allow all bucket policy on top of the exported nsfs bucket
function create_and_apply_bucket_policy(){
print_headline "APPLY BUCKET POLICY" "Creating bucket policy policy.json file:"
policy_json='
{
"Version":"2012-10-17",
"Statement":[
    {
    "Sid":"id-1",
    "Effect":"Allow",
    "Principal":"*",
    "Action":["s3:*"],
    "Resource":["arn:aws:s3:::*"]
    }
]
}
';

cat <<EOF >/tmp/policy.json
$policy_json
EOF

echo -e "Applying bucket policy on $EXPORTED_BUCKET_NAME bucket:\n";
AWS_ACCESS_KEY_ID=$admin_account_access_key AWS_SECRET_ACCESS_KEY=$admin_account_secret_key aws s3api put-bucket-policy --endpoint $ENDPOINT --bucket $EXPORTED_BUCKET_NAME --policy file:///tmp/policy.json --no-verify-ssl;
rm /tmp/policy.json
print_done
}


# create_nsfs_account - creates a noobaa account with nsfs configuration in order to access nsfs buckets
function create_nsfs_account(){
set +e
print_headline "NSFS ACCOUNT CREATION" "Creating a nsfs account in order to access nsfs buckets on top of ${NSFS_RESOURCE_NAME} namespace resource, uid=0 gid=0:"
output=$(noobaa api account_api create_account '{
  "email": "'"$NSFS_ACCOUNT_NAME"'",
  "name" : "nsfs-account",
  "has_login": false,
  "s3_access": true,
  "default_resource": "'"${NSFS_RESOURCE_NAME}"'", 
  "nsfs_account_config": {
    "uid": 0,
    "gid": 0,
    "new_buckets_path": "/", 
    "nsfs_only": true 
  }
}' 2>&1);
skip_already_exist_error "${output}" "create nsfs account"
print_done
set -e
}


function delete_nsfs_account(){
print_headline "NSFS ACCOUNT DELETION" "Deleting $NSFS_ACCOUNT_NAME account:"
account=$(noobaa api account_api delete_account '{"email":"'"$NSFS_ACCOUNT_NAME"'"}' -o json);
print_done
}


# read_nsfs_account - reads the created account in order to check it was created appropriately and in order to use the account's credentials 
# in the next s3 requests
function read_nsfs_account(){
print_headline "READ NSFS ACCOUNT" "Reading the nsfs account:"
account=$(noobaa api account_api read_account '{"email":"'"$NSFS_ACCOUNT_NAME"'"}' -o json);
account_access_key=$(echo $account | jq -r '.access_keys[0].access_key');
account_secret_key=$(echo $account | jq -r '.access_keys[0].secret_key');
print_done
}


# create_s3_bucket - creates s3 bucket using the nsfs account created in the previous step
function create_s3_bucket(){
set +e
print_headline "S3 CREATE BUCKET" "Calling make bucket (s3 mb) using the newly created nsfs account:"
output=$(AWS_ACCESS_KEY_ID=$account_access_key AWS_SECRET_ACCESS_KEY=$account_secret_key aws --endpoint $ENDPOINT --no-verify-ssl s3 mb s3://$S3_BUCKET_NAME 2>&1);
skip_already_exist_error "${output}" "create nsfs bucket (S3)"
print_done
set -e
}


# delete_s3_bucket - deleted s3 bucket using the nsfs account created in the previous step
function delete_s3_bucket(){
print_headline "S3 DELETE BUCKET" "Calling delete bucket (s3 rm) using $NSFS_ACCOUNT_NAME nsfs account:"
echo -e "deleting objects:"
AWS_ACCESS_KEY_ID=$account_access_key AWS_SECRET_ACCESS_KEY=$account_secret_key aws --endpoint $ENDPOINT --no-verify-ssl s3 rm s3://$S3_BUCKET_NAME --recursive;
echo -e "\ndeleting bucket:"
AWS_ACCESS_KEY_ID=$account_access_key AWS_SECRET_ACCESS_KEY=$account_secret_key aws --endpoint $ENDPOINT --no-verify-ssl s3 rb s3://$S3_BUCKET_NAME;
print_done
}


# assert_s3_bucket_folder_created - checks that noobaa created the underlying folder during the s3 bucket creation of the previous step
function assert_s3_bucket_folder_created(){
print_headline "CHECK FOLDER CREATED IN FS" "Checking that a folder that represents the bucket was created by noobaa in minikube file system:"
echo -e "$minikube ssh -- sudo ls -l /nsfs/;\n";
minikube ssh -- "sudo ls -l /nsfs/;";
print_done
}


# upload_object_to_buckets - upload objects to the exported bucket (RPC) and to the s3 nsfs bucket (S3)
function upload_object_to_buckets(){
print_headline "S3 UPLOAD OBJECTS" ""
echo -e "Calling upload object to s3://$S3_BUCKET_NAME bucket using the newly created nsfs account:\n";
echo file_content_of_s3_bucket | AWS_ACCESS_KEY_ID=$account_access_key AWS_SECRET_ACCESS_KEY=$account_secret_key aws --endpoint $ENDPOINT --no-verify-ssl s3 cp - s3://$S3_BUCKET_NAME/empty_file.txt;
print_done

echo -e "Calling upload object to s3://$EXPORTED_BUCKET_NAME bucket using the newly created nsfs account:\n";
echo file_content_of_rpc_exported_bucket | AWS_ACCESS_KEY_ID=$account_access_key AWS_SECRET_ACCESS_KEY=$account_secret_key aws --endpoint $ENDPOINT --no-verify-ssl s3 cp - s3://$EXPORTED_BUCKET_NAME/empty_file.txt;
print_done
}

function check_for_error_and_exit(){
if [ $? -ne 0 ]; then
    exit 1
fi
}

function full_deployment() {
print_headline "FULL DEPLOYMENT" "Starting full nsfs deployment:"
check_pre_requisites
set_endpoint_url
set_admin_credentials
create_sc_pv_pvc
minikube_export_dir_creation
create_namespace_resource
wait_for_endpoint_pod_to_restart
create_nsfs_exported_bucket
start_portforward
create_and_apply_bucket_policy
create_nsfs_account
read_nsfs_account
create_s3_bucket
assert_s3_bucket_folder_created
upload_object_to_buckets
stop_portforward
echo "Finished full nsfs deployment successfully!"
}


function cleanup() {
set +e
print_headline "FULL NSFS CLEANUP" "Starting full nsfs cleanup:"
check_pre_requisites
set_endpoint_url
start_portforward
read_nsfs_account
delete_s3_bucket
delete_nsfs_exported_bucket
delete_nsfs_account
delete_namespace_resource
minikube_export_dir_deletion
delete_sc_pv_pvc
stop_portforward
echo "Finished full nsfs cleanup successfully"
set -e
}

function check_pre_requisites(){
print_headline "PREREQUISITES CHECK" "Checking all pre requisites accomplished:"

#check kubectl client installed
if ! [ -x "$(command -v kubectl)" ]; then
  echo 'kubectl client is not installed.' >&2
  exit 1
fi

#check aws client installed
if ! [ -x "$(command -v aws)" ]; then
  echo 'aws client is not installed.' >&2
  exit 1
fi

#check noobaa/nb client installed
if ! [ -x "$(command -v noobaa)" ]; then
    echo 'noobaa client is not installed.' >&2
    exit 1
fi

#check noobaa system installed and ready
output=$(kubectl get noobaa noobaa | grep -c Ready)
if [[ $output -ne 1 ]]; then
  echo 'noobaa system not ready.' >&2
  exit 1
fi

print_done
}

function main(){
if [ $# -gt 1 ]
then
    print_usage $1
elif [ "$1" == "help" ]
then
    print_usage $1
elif [ "$1" == "h" ]
then
    print_usage $1
elif [ "$1" == "deployment" ]
then
    full_deployment
elif [ "$1" == "cleanup" ]
then
    cleanup
else
    echo -e "Error: unknown command $1"
    print_usage $1
fi
}

main $@
