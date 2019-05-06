# script to cleanup all artifacts of bucket creation.
# $1 = obc name (required), $2 = OBC's namespace (optional)
#
if (( $# == 0 || $# > 2 )); then
   echo
   echo "Cleans up the secret, configmap and OB for the given OBC"
   echo "Usage: $0 obc-name [obc-namespace]"
   exit 1
fi
errcnt=0
obcName="$1"; ns="$2"
if [[ -z "$obcName" ]]; then
   echo "OBC name is required"
   exit 1
fi
[[ -z "$ns" ]] && ns="default"

echo
echo "Cleaning up for OBC \"$ns/obcName\"..."

if kubectl get obc -n=$ns $obcName; then
   echo
   echo "delete obc $ns/$obcName..."
   kubectl delete obc -n=$ns $obcName
   (( $? != 0 )) && ((errcnt++))
fi

# secret and cm have finalizers which need to be removed
if kubectl get secret -n=$ns $obcName; then 
   echo
   echo "delete secret $ns/$obcName..."
   kubectl patch --type=merge secret -n=$ns $obcName -p '{"metadata":{"finalizers": [null]}}' && \
   kubectl delete secret -n=$ns $obcName
   (( $? != 0 )) && ((errcnt++))
fi

if kubectl get cm -n=$ns $obcName; then
   echo
   echo "delete configmap $ns/$obcName..."
   kubectl patch --type=merge cm -n=$ns $obcName -p '{"metadata":{"finalizers": [null]}}' && \
   kubectl delete cm -n=$ns $obcName
   (( $? != 0 )) && ((errcnt++))
fi

ob="obc-$ns-$obcName"
if kubectl get ob $ob; then
   echo
   echo "delete ob $ob..."
   kubectl patch --type=merge ob $ob -p '{"metadata":{"finalizers": [null]}}' && \
   kubectl delete ob $ob
   (( $? != 0 )) && ((errcnt++))
fi

echo
echo "end of cleanup with $errcnt errors"
