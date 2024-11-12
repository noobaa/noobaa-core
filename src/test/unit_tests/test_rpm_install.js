/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
const os_utils = require('../../util/os_utils');

mocha.describe('rpm install tests', function() {
    mocha.it('rpm build & install', async () => {
        console.log('installing pre-requisites');

        const install_wget = 'dnf install wget';
        await exec(install_wget);
        console.log('installed wget');

        const downlod_boost_system = 'wget https://rpmfind.net/linux/centos-stream/9-stream/AppStream/x86_64/os/Packages/boost-system-1.75.0-8.el9.x86_64.rpm';
        await exec(downlod_boost_system);
        console.log('downloaded boost system RPM');
        const downlod_boost_thread = 'wget https://rpmfind.net/linux/centos-stream/9-stream/AppStream/x86_64/os/Packages/boost-thread-1.75.0-8.el9.x86_64.rpm';
        await exec(downlod_boost_thread);
        console.log('downloaded boost thread RPM');

        const install_boost_system_rpm = 'rpm -i boost-system-1.75.0-8.el9.x86_64.rpm';
        await exec(install_boost_system_rpm);
        console.log('installed boost system RPM');

        const install_boost_thread_rpm = 'rpm -i boost-thread-1.75.0-8.el9.x86_64.rpm';
        await exec(install_boost_thread_rpm);
        console.log('installed boost thread RPM');

        const cd_cwd_command = 'cd ' + process.cwd();
        await exec(cd_cwd_command);
        console.log('cd process.cwd()', process.cwd());

        const make_rpm_command = 'make rpm BUILD_S3SELECT=0';
        await exec(make_rpm_command);
        console.log('finished make rpm');

        const get_noobaa_rpm_path_command = 'noobaa_pkg=$(ls ./build/rpm/ | grep noobaa | grep .x86_64.rpm)';
        await exec(get_noobaa_rpm_path_command);
        console.log('got noobaa rpm path');

        const install_rpm_command = 'rpm -i "./build/rpm/$noobaa_pkg"';
        await exec(install_rpm_command);
        console.log('installed noobaa rpm');

    });
});

/**
 * exec executes a command within a shell
 * @param {String} command 
 */
async function exec(command) {
    try {
        const res = await os_utils.exec(command, {
            return_stdout: true
        });
        return res;
    } catch (err) {
        console.error('test_rpm_install.error', err);
        throw err;
    }
}
