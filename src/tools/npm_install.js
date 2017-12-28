/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const child_process = require('child_process');

// this script is used by 'npm run build:fe' (see package.json)
// and is needed to conditionally run npm install in frontend/ folder
// but skip it if the frontend folder is missing such as when building agent package.
const folder = process.argv[2];

if (fs.existsSync(folder)) {
    child_process.spawn('npm', ['install'], {
        cwd: folder,
        stdio: 'inherit',
    });
}
