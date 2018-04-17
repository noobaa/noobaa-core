/* Copyright (C) 2016 NooBaa */
'use strict';

const argv = require('minimist')(process.argv);
const ssh = require('../utils/ssh_functions');
const _ = require('lodash');
require('../../util/dotenv').load();

const envDir = '/tmp/.env';

const {
    lg_name,
    lg_ip,
    script_to_run
} = argv;

_.each(process.env, envKey => {
    if (envKey.includes(argv.storage)) {
        process.env.AZURE_STORAGE_CONNECTION_STRING = envKey;
    }
});



const script = `
pwd
echo AZURE_SUBSCRIPTION_ID=${process.env.AZURE_SUBSCRIPTION_ID} > ${envDir}
echo CLIENT_ID=${process.env.CLIENT_ID} >> ${envDir}
echo APPLICATION_SECRET=${process.env.APPLICATION_SECRET} >> ${envDir}
echo DOMAIN=${process.env.DOMAIN} >> ${envDir}
echo AZURE_STORAGE_CONNECTION_STRING='${process.env.AZURE_STORAGE_CONNECTION_STRING}' >> ${envDir}
JENKINS_URL=${process.env.JENKINS_URL}
WORKSPACE=noobaa-core
rm -rf /tmp/noobaa-core/ &> /dev/null
rm -rf /tmp/noobaa-NVA-latest.tar.gz
rm -rf $WORKSPACE/
curl -u jackyalbo:711d9303458d34ad56c1a48716c02ee5e286570f -L $JENKINS_URL/job/Build/job/Build-Package-Master/lastSuccessfulBuild/api/xml >/tmp/lastSuccessfulBuild.xml
buildPath=$(cat /tmp/lastSuccessfulBuild.xml | awk -F "<relativePath>" '{print $2}' | awk -F "</relativePath>" '{print $1}' | xargs)
curl -u jackyalbo:711d9303458d34ad56c1a48716c02ee5e286570f -L $JENKINS_URL/job/Build/job/Build-Package-Master/lastSuccessfulBuild/artifact/$buildPath >/tmp/noobaa-NVA-latest.tar.gz
tar -zxvf /tmp/noobaa-NVA-latest.tar.gz &> /dev/null
cd $WORKSPACE/
npm install 1> /dev/null
cp ${envDir} .env
args=${process.argv}
node ${script_to_run} \${args//,/ }
pwd
`;

function main() {
    console.log(`running runner tests on ${lg_name}, IP ${lg_ip}`);
    let ssh_client;
    return ssh.ssh_connect({
            host: lg_ip,
            username: 'root',
            password: process.env.LG_PASSWORD,
            keepaliveInterval: 5000,
        })
        .then(client => {
            ssh_client = client;
            return ssh.ssh_exec(ssh_client, script);
        })
        .then(() => {
                console.log('SUCCESSFUL TESTS');
                process.exit(0);
            },
            err => {
                console.error('Remote Runner FAILED:', err.message);
                process.exit(1);
            }
        );
}

if (require.main === module) {
    main();
}
