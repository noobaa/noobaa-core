/* Copyright (C) 2016 NooBaa */
'use strict';

const bcrypt = require('bcrypt');

// This is to support shell scripts
// It is used in order to bcrypt support account password in mongo_upgrade
const password = process.argv[2] || '';
const hash = process.argv[3] || '';

if (hash) {
    console.log(bcrypt.compareSync(password, hash));
} else {
    console.log(bcrypt.hashSync(password, 10));
}
