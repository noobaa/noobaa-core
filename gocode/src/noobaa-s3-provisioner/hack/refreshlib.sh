# refresh the bucket provisioning lib, from the supplied branch (default is 
# master), and vendor it.

branch="$1"
[[ -z "$branch" ]] && branch="master"

echo "refreshing bucket lib from \"$branch\" branch..."
sed -ri "s,(.*lib-bucket-provisioner).*,\1 $branch," go.mod && vgo mod vendor
