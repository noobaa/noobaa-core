/* Copyright (C) 2016 NooBaa */
'use strict';


const argv = require('minimist')(process.argv);

const sanity_build_test = require('../system_tests/sanity_build_test');



async function main() {
    const ip = argv.target || 'localhost';
    const port = argv.port || '8080';
    console.time('sanity configuration');
    await sanity_build_test.run_configuration_test(ip, port);
    console.timeEnd('sanity configuration');
    process.exit();
}

if (require.main === module) {
    main();
}
