#!/bin/bash

currdir="$(pwd)"

function help_msg() {
	echo "Usage: $0 <device-or-directory> <bucket-data-path> <pool-name>"
}

if [[ $# -ne 3 ]]; then
	help_msg
	exit 1
fi

DEVICE_DIRECTORY="$1"
BUCKET_DATA_PATH="$2"
POOL_NAME="$3"

POLICY_DIR="${currdir}/src/deploy/spectrum_archive/policies"
RESTORE_AND_MIGRATE_POLICY="${POLICY_DIR}/restore_and_migrate.policy"
MIGRATE_PREMIGRATED_POLICY="${POLICY_DIR}/migrate_premigrated.policy"

if [[ ! -d "${BUCKET_DATA_PATH}" ]]; then
	echo "Invalid bucket data path: ${BUCKET_DATA_PATH}"
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

	if [[ ! -d "${POLICY_DIR}" ]]
	then
		echo "policies directory could not be found"
		echo "Creating"
		mkdir -p "${POLICY_DIR}"
	fi
}

function migrate_premigrated_policy() {
	local eeadmpath=`which eeadm`
	cat > "${MIGRATE_PREMIGRATED_POLICY}" <<EOF
define(user_exclude_list,(PATH_NAME LIKE '/ibm/gpfs/.ltfsee/%' OR PATH_NAME LIKE '/ibm/gpfs/.SpaceMan/%'))
define(is_premigrated,(MISC_ATTRIBUTES LIKE '%M%' AND MISC_ATTRIBUTES NOT LIKE '%V%'))

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
            is_premigrated
            AND
            CURRENT_TIMESTAMP - TIMESTAMP(SUBSTR(xattr('user.noobaa.restore.expiry'), 0, 10)) >= INTERVAL '0' DAYS
    )
    AND NOT user_exclude_list
EOF
}

function restore_and_migrate_policy() {
	local eeadmpath=`which eeadm`
	cat > "${RESTORE_AND_MIGRATE_POLICY}" <<EOF
define(user_exclude_list,(PATH_NAME LIKE '/ibm/gpfs/.ltfsee/%' OR PATH_NAME LIKE '/ibm/gpfs/.SpaceMan/%'))
define(is_migrated,(MISC_ATTRIBUTES LIKE '%V%'))
define(is_resident,(NOT MISC_ATTRIBUTES LIKE '%M%'))

RULE EXTERNAL LIST 'CANDIDATES_LIST'
EXEC '${currdir}/src/deploy/spectrum_archive/process_restore_candidates.sh'

RULE 'LTFSEE_FILES_RULE' LIST 'CANDIDATES_LIST'
WHERE 
    FILE_SIZE > 0
    AND is_migrated
    AND NOT user_exclude_list
    AND PATH_NAME LIKE '${BUCKET_DATA_PATH}/%'
    AND xattr('user.storage_class') = 'GLACIER'
    AND xattr('user.noobaa.restore.request') is NOT NULL
    AND xattr('user.noobaa.restore._request') IS NULL

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
    AND is_resident
    AND NOT user_exclude_list
EOF
}

function setup_policy_files_if_absent() {
	if [[ ! -f "${MIGRATE_PREMIGRATED_POLICY}" ]]; then
		migrate_premigrated_policy
	fi

	if [[ ! -f "${RESTORE_AND_MIGRATE_POLICY}" ]]; then
		restore_and_migrate_policy
	fi
}

function setup_cron_triggers() {
	local migcmd="`which mmapplypolicy` ${DEVICE_DIRECTORY} -P \"${MIGRATE_PREMIGRATED_POLICY}\""
	# Run everyday at 00:00
	local migjob="0 0 * * * ${migcmd}"

	local res_mig_cmd="`which mmapplypolicy` ${DEVICE_DIRECTORY} -P \"${RESTORE_AND_MIGRATE_POLICY}\""
	# Run every 15 minutes
	local res_mig_job="*/15 * * * * ${res_mig_cmd}"

	crontab -l | fgrep -i -v "${migcmd}" | { cat; echo "${migjob}"; } | crontab -
	crontab -l | fgrep -i -v "${res_mig_cmd}" | { cat; echo "${res_mig_job}"; } | crontab -
}

function main() {
	sanity_checks
	setup_policy_files_if_absent
	setup_cron_triggers
}

main