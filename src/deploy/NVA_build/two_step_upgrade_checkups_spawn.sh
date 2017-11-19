EXTRACTION_PATH="/tmp/test/"
NEW_TMP_ROOT="/tmp/test/noobaa-core/";
NEW_UPGRADE_UTILS="/tmp/test/noobaa-core/src/upgrade/upgrade_utils.js --new_pre_upgrade";
NODEVER=$(cat /tmp/test/noobaa-core/.nvmrc)
mkdir -p /tmp/v${NODEVER}
cp -f ${NEW_TMP_ROOT}build/public/node-v${NODEVER}-linux-x64.tar.xz /tmp/
tar -xJf /tmp/node-v${NODEVER}-linux-x64.tar.xz -C /tmp/v${NODEVER} --strip-components 1
/tmp/v${NODEVER}/bin/node ${NEW_UPGRADE_UTILS}