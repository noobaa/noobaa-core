#!/bin/bash

currdir="`pwd`"

function help_msg() {
	echo "Usage: $0 <device-or-directory> <bucket-data-path> <pool-name>"
}

if [ $# -ne 3 ]; then
	help_msg
	exit 1
fi

DEVICE_DIRECTORY="$1"
BUCKET_DATA_PATH="$2"
POOL_NAME="$3"

if [ ! -d "$BUCKET_DATA_PATH" ]; then
	echo "Invalid bucket data path: $BUCKET_DATA_PATH"
	exit 1
fi

function sanity_checks() {
	if ! command -v eeadm &> /dev/null
	then
		echo "eeadm could not be found"
		exit 1
	fi

	if ! command -v mmapplypolicy &> /dev/null
	then
		echo "mmapplypolicy could not be found"
		exit 1
	fi

	if [ ! -d "$currdir/src/deploy/spectrum_archive/policies" ]
	then
		echo "policies directory could not be found"
		echo "Creating"
		mkdir -p "$currdir/src/deploy/spectrum_archive/policies"
	fi
}

function migrate_policy() {
	local eeadmpath=`which eeadm`
	cat > $currdir/src/deploy/spectrum_archive/policies/migrate.policy <<EOF
define(user_exclude_list,(PATH_NAME LIKE '/ibm/gpfs/.ltfsee/%' OR PATH_NAME LIKE '/ibm/gpfs/.SpaceMan/%'))
define(is_premigrated,(MISC_ATTRIBUTES LIKE '%M%' AND MISC_ATTRIBUTES NOT LIKE '%V%'))
define(is_resident,(NOT MISC_ATTRIBUTES LIKE '%M%'))

RULE 'SYSTEM_POOL_PLACEMENT_RULE' SET POOL 'system'

RULE EXTERNAL POOL 'ltfs'
EXEC '${eeadmpath}'
OPTS '-p ${POOL_NAME}'

RULE 'LTFS_EE_FILES' MIGRATE FROM POOL 'system'
TO POOL 'ltfs'
WHERE
    FILE_SIZE > 0
    AND PATH_NAME LIKE '${BUCKET_DATA_PATH}/%'
    AND xattr('user.storage_class') = 'GLACIER'
    AND (
            (is_resident)
            OR
            (
                    is_premigrated
                    AND
                    CURRENT_TIMESTAMP - TIMESTAMP(SUBSTR(xattr('user.noobaa.restore.expiry'), 0, 10)) >= INTERVAL '0' DAYS
            )
    )
    AND NOT user_exclude_list
EOF
}

function restore_policy() {
	local eeadmpath=`which eeadm`
	cat > $currdir/src/deploy/spectrum_archive/policies/restore.policy <<EOF
define(user_exclude_list,(PATH_NAME LIKE '/ibm/gpfs/.ltfsee/%' OR PATH_NAME LIKE '/ibm/gpfs/.SpaceMan/%'))
define(is_migrated,(MISC_ATTRIBUTES LIKE '%V%'))

RULE EXTERNAL LIST 'CANDIDATES_LIST'
EXEC '$currdir/src/deploy/spectrum_archive/process_restore_candidates.sh'

RULE 'LTFSEE_FILES_RULE' LIST 'CANDIDATES_LIST'
WHERE 
    FILE_SIZE > 0
    AND is_migrated
    AND NOT user_exclude_list
    AND PATH_NAME LIKE '${BUCKET_DATA_PATH}/%'
    AND xattr('user.storage_class') = 'GLACIER'
    AND xattr('user.noobaa.restore.request') is NOT NULL
    AND xattr('user.noobaa.restore._request') IS NULL
EOF
}

function setup_policy_files_if_absent() {
	if [ ! -f "$currdir/src/deploy/spectrum_archive/policies/restore.policy" ]; then
		migrate_policy
	fi

	if [ ! -f "$currdir/src/deploy/spectrum_archive/policies/migrate.policy" ]; then
		restore_policy
	fi
}

function setup_cron_triggers() {
	local migcmd="`which mmapplypolicy` ${DEVICE_DIRECTORY} -P \"$currdir/src/deploy/spectrum_archive/policies/migrate.policy\""
	# Run everyday at 00:00
	local migjob="0 0 * * * $migcmd"

	local rescmd="`which mmapplypolicy` ${DEVICE_DIRECTORY} -P \"$currdir/src/deploy/spectrum_archive/policies/restore.policy\""
	# Run every 15 minutes
	local resjob="*/15 * * * * $rescmd"

	crontab -l | fgrep -i -v "$migcmd" | { cat; echo "$migjob"; } | crontab -
	crontab -l | fgrep -i -v "$rescmd" | { cat; echo "$resjob"; } | crontab -
}

function main() {
	sanity_checks
	setup_policy_files_if_absent
	setup_cron_triggers
}

main