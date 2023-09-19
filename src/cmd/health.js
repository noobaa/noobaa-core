/* Copyright (C) 2020 NooBaa */
'use strict';

const os_util = require('../util/os_utils');
const { make_https_request } = require('../util/http_utils');
const minimist = require('minimist');



const HELP = `
Help:

    "nsfs" is a noobaa-core command runs a local S3 endpoint on top of a filesystem.
    Each sub directory of the root filesystem represents an S3 bucket.
    Health command will return the health status of deployed nsfs.
`;

const USAGE = `
Usage:

    node src/cmd/health [options...]
`;


const OPTIONS = `
Options:

    --deployment_type <type>         (default nc)   Set the nsfs type for heath check.

`;

function print_usage() {
    console.warn(HELP);
    console.warn(USAGE.trimStart());
    console.warn(OPTIONS.trimStart());
    process.exit(1);
}

const HOSTNAME = "localhost";
const PORT = 6443;
const SERVICE = "nsfs";

async function nc_nsfs_health() {

    const {service_status, pid} = await get_service_state();
    const status_code = await get_endpoint_response();
    const memory = await get_service_memory_usage();
    let service_health = "OK";
    if (service_status !== "active" || pid === "0" || status_code !== 200) {
      service_health = "NOTOK";
    }
    const helath = {
      service_name: 'nsfs',
      status: service_health,
      memory: memory,
      checks: {
          service: {
              service_status: service_status,
              pid: pid,
          },
          endpoint: {
              endpoint_response: status_code,
          },
      }
  };
  console.log(helath);
}

async function get_service_state() {
  const service_status = await os_util.exec('systemctl show -p ActiveState --value ' + SERVICE, {
    ignore_rc: true,
    return_stdout: true,
    trim_stdout: true,
  });
  const pid = await os_util.exec('systemctl show --property MainPID --value ' + SERVICE, {
    ignore_rc: true,
    return_stdout: true,
    trim_stdout: true,
  });
  return { service_status: service_status, pid: pid };
}

async function get_endpoint_response() {
  const path = '';
    try {
        const response = await make_https_request({ HOSTNAME, port: PORT, path, method: 'GET',
                              rejectUnauthorized: false });
        if (response) {
          const status_code = response.statusCode;
          return status_code;
        }
    } catch (err) {
      console.debug('Error while pinging endpoint host :' + HOSTNAME + ', port ' + PORT);
    }
    return 0;
}

async function get_service_memory_usage() {
  const memory_status = await os_util.exec('systemctl status ' + SERVICE + ' | grep Memory ', {
    ignore_rc: true,
    return_stdout: true,
    trim_stdout: true,
  });
  if (memory_status) {
    const memory = memory_status.split("Memory: ")[1].trim();
    return memory;
  }
}


async function main(argv = minimist(process.argv.slice(2))) {
  try {

    if (argv.help || argv.h) return print_usage();

    const deployment_type = argv.deployment_type || 'nc';
    if (deployment_type === 'nc') {
      return nc_nsfs_health();
    } else {
      console.log('Health is not supported for simple nsfs deployment.');
    }
  } catch (err) {
    console.error('Helath: exit on error', err.stack || err);
    process.exit(2);
  }
}

exports.main = main;

if (require.main === module) main();
