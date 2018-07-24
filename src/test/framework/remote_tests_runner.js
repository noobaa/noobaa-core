/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
require('../../util/dotenv').load();
const ssh = require('../utils/ssh_functions');
const argv = require('minimist')(process.argv);

const envDir = '/tmp/.env';

const {
    lg_name,
    lg_ip,
    script_to_run,
    version = 'latest',
} = argv;

_.each(process.env, envKey => {
    if (envKey.includes(argv.storage)) {
        process.env.AZURE_STORAGE_CONNECTION_STRING = envKey;
    }
});

const script = `
echo AZURE_SUBSCRIPTION_ID=${process.env.AZURE_SUBSCRIPTION_ID} > ${envDir}
echo CLIENT_ID=${process.env.CLIENT_ID} >> ${envDir}
echo APPLICATION_SECRET=${process.env.APPLICATION_SECRET} >> ${envDir}
echo DOMAIN=${process.env.DOMAIN} >> ${envDir}
echo AZURE_STORAGE_CONNECTION_STRING='${process.env.AZURE_STORAGE_CONNECTION_STRING}' >> ${envDir}
sorceKey=$(grep "AZURE_STORAGE_CONNECTION_STRING" ${envDir} | awk -F ';AccountKey=' '{print $2}' | awk -F ';EndpointSuffix' '{print $1}')
JENKINS_URL=${process.env.JENKINS_URL}
WORKSPACE=noobaa-core
rm -rf /tmp/noobaa-core/ &> /dev/null
rm -rf /tmp/noobaa-NVA-latest.tar.gz
rm -rf $WORKSPACE/
if [ ${version} == 'latest' ]
then
    curl -u jackyalbo:711d9303458d34ad56c1a48716c02ee5e286570f -L $JENKINS_URL/job/Build/job/Build-Package-Master/lastSuccessfulBuild/api/xml >/tmp/lastSuccessfulBuild.xml
    buildPath=$(cat /tmp/lastSuccessfulBuild.xml | awk -F "<relativePath>" '{print $2}' | awk -F "</relativePath>" '{print $1}' | xargs)
    curl -u jackyalbo:711d9303458d34ad56c1a48716c02ee5e286570f -L $JENKINS_URL/job/Build/job/Build-Package-Master/lastSuccessfulBuild/artifact/$buildPath >/tmp/noobaa-NVA-latest.tar.gz
else 
    yes | azcopy --source http://jenkinspipeline7.blob.core.windows.net/staging-vhds/ --include noobaa-NVA-${version}.tar.gz --destination /tmp/ --source-key $sorceKey
    mv /tmp/noobaa-NVA-${version}.tar.gz /tmp/noobaa-NVA-latest.tar.gz
fi
tar -zxvf /tmp/noobaa-NVA-latest.tar.gz &> /dev/null
cd $WORKSPACE/
npm install 1> /dev/null
cp ${envDir} .env
args=${process.argv}
node ${script_to_run} \${args//,/ }
`;

async function main() {
    console.log(`Running runner tests on ${lg_name}, ip ${lg_ip}`);
    try {
        const ssh_client = await ssh.ssh_connect({
            host: lg_ip,
            username: 'root',
            password: process.env.LG_PASSWORD,
            keepaliveInterval: 5000,
        });
        await ssh.ssh_exec(ssh_client, script);
        console.log('SUCCESSFUL TESTS');
        process.exit(0);
    } catch (err) {
        console.error('Remote Runner FAILED:', err.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
