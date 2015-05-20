//Depricated and NOT COMPLETE

/* jshint node:true */
'use strict';

var request = require('request');
var child_proc = require('child_process');

//var npm = require("npm");

var args = process.argv.slice(2);
var current_hash = args[0];
var increment = args[1];

console.log('Got args hash', current_hash, ' increment', increment);

//Auth
var username = 'noobaa-dep';
var token = '92a46eb3c399aaafb250a04633a9c3ee64f2396d';

//Exec consts
var cd_command = 'cd C:\\Users\\Administrator\\Documents\\GitHub\\noobaa-core ';
var git_command = '&& "C:\\Program Files (x86)\\Git\\bin\\git.exe" ';

var current_version, next_version;

function advance_version(current_version, increment) {
    var current_version_parts = current_version.toString().split('.');
    var increment_version_parts = increment.toString().split('.');
    var output_version = '';

    var len = Math.min(current_version_parts.length, increment_version_parts.length);

    var new_part;
    for (var i = 0; i < len; i++) {
        //if current part of increment is not 0, increment
        if (increment_version_parts[i] !== '0') {
            new_part = parseInt(current_version_parts[i]) + parseInt(increment_version_parts[i]);
        } else {
            new_part = current_version_parts[i];
        }
        output_version += new_part + '.';
    }

    //went over common part, now add tails if there are
    if (current_version_parts.length > increment_version_parts.length) {
        for (var j1 = len; j1 < current_version_parts.length; ++j1) {
            output_version += current_version_parts[j1] + '.';
        }
    }

    if (current_version_parts.length < increment_version_parts.length) {
        for (var j2 = len; j2 < increment_version_parts.length; ++j2) {
            output_version += increment_version_parts[j2] + '.';
        }
    }

    //remove tailing .
    output_version = output_version.slice(0, -1);

    return output_version;
}


//Assuming git config credential.helper store was called and password is not required anymore
function create_branch(next_version) {
    var git_flags, out;

    git_flags = 'pull';
    out = child_proc.execSync(cd_command + git_command + git_flags);
    process.stdout.write(out);

    git_flags = 'checkout -b build_release_v' + next_version + ' ' + current_hash;
    out = child_proc.execSync(cd_command + git_command + git_flags);
    process.stdout.write(out);
}

function build_package() {
	var out;
	var orig = 'C:\\Users\\Administrator\\Documents\\GitHub\\noobaa-core\\src\\deploy\\NVA_build\\env.orig';
	var dest = 'C:\\Users\\Administrator\\Documents\\GitHub\\noobaa-core\\.env';
	out = child_proc.execSync('copy ' + orig + ' ' + dest);
	process.stdout.write(out);

	out = child_proc.execSync(cd_command + ' && gulp NVA_build');
	process.stdout.write(out);
}


request({
        url: 'https://api.github.com/repos/noobaa/noobaa-core/releases/latest',
        headers: {
            'User-Agent': 'request'
        },
        auth: {
            user: username,
            pass: token
        },
    },
    function(err, res, body) {
        if (!err && res.statusCode === 200) {
            //Create new version
            var info = JSON.parse(body);
            current_version = parseFloat(info.tag_name.substr(info.tag_name.indexOf('v') + 1));
            next_version = advance_version(current_version, increment);
            console.log('Current version', current_version, 'Will release', next_version);

            //Create a branch a build the package
            create_branch(next_version);

            //Build upgrade package
            build_package();
            //upload_package();

            //Create new release
            //create_release();
        } else {
            process.exit(1);
        }
    });


/*
git checkout -b build_release_v${newver} ${commit}
npm install
gulp NVA_build


#aws s3 cp C:\Users\Administrator\Documents\GitHub\noobaa-core\build\public\noobaa-NVA.tar.gz s3://noobaa-download/on_premise/v_${newver}
#git branch -D build_release_v${newver}
exit 0*/
