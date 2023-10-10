#!/bin/bash

# This script is called by mmapplypolicy to process a candidate file
if [ $# -ne 2 ]; then
	echo "Usage: $0 <OP> <candidate file>"
	exit 1
fi

function get_expiry() {
	local requested_days=$(attr -q -g "noobaa.restore._request" "$1")
	if [ $? -ne 0 ]; then
		echo "Failed to get attr noobaa.restore._request on $1"
		exit 1
	fi

	# Take the current date and add "requested_days" to it and strip away the time
	# bits just like AWS does
	# This format is ISO 8601
	local expiry=$(date -u -d "+${requested_days} days" +"%Y-%m-%dT00:00:00.000Z")

	echo "$expiry"
}

# adjust_init_attrs takes the name of the candidate file and adjusts the attributes
# by parsing the file line by line and executing `attr` commands
# The candidate file content looks like <inode> <gen> <snapid> <other> -- <path> and
# want to set attrs on the file on the path
function adjust_init_attrs() {
	local candidate_file="$1"
	local line
	local path

	while read line; do
		path="$(echo "$line" | awk --field-separator=' -- ' '{print $2}')"

		attr -q -s "noobaa.restore._request" -V $(attr -q -g "noobaa.restore.request" "$path") "$path"
		if [ $? -ne 0 ]; then
			echo "Failed to set attr noobaa.restore._request on $path"
			exit 1
		fi

		attr -q -r "noobaa.restore.request" "$path"
		if [ $? -ne 0 ]; then
			echo "Failed to remove attr noobaa.restore.request on $path"
			exit 1
		fi

		attr -q -s "noobaa.restore.ongoing" -V "true" "$path"
		if [ $? -ne 0 ]; then
			echo "Failed to set attr noobaa.restore.ongoing on $path"
			exit 1
		fi
	done <"$candidate_file"
}

function adjust_final_attrs() {
	local candidate_file="$1"
	local line
	local path

	while read line; do
		path="$(echo "$line" | awk --field-separator=' -- ' '{print $2}')"

		attr -q -s "noobaa.restore.expiry" -V $(get_expiry "$path") "$path"
		if [ $? -ne 0 ]; then
			echo "Failed to set attr noobaa.restore.expiry on $path"
			exit 1
		fi

		attr -q -r "noobaa.restore._request" "$path"
		if [ $? -ne 0 ]; then
			echo "Failed to remove attr noobaa.restore.request on $path"
			exit 1
		fi

		attr -q -r "noobaa.restore.ongoing" "$path"
		if [ $? -ne 0 ]; then
			echo "Failed to remove attr noobaa.restore.ongoing on $path"
			exit 1
		fi
	done <"$candidate_file"
}

if [ "$1" == "LIST" ]; then
	adjust_init_attrs "$2"
	/opt/ibm/ltfsee/bin/eeadm recall "$2"
	adjust_final_attrs "$2"
fi
