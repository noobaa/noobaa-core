## How to run namespace cache tests locally
- Copy config-local.js to the root of the repository
- Start the services locally

    - npm run db
    - npm run web_server
    - npm run hosted_agents
    - npm run bg
    - npm run s3

- Set the following envs for the command to be run below

        export COS_ACCESS_KEY_ID=<ibm_cos_access_key_id>
        export COS_SECRET_ACCESS_KEY=<<ibm_cos_secret_acccess_key>
        export SYSTEM_NAME=<name_of_noobaa_system>
        export NB_ACCESS_KEY_ID=<noobaa_access_key_id>
        export NB_SECRET_ACCESS_KEY=<noobaa_secret_acccess_key>

- Run

        cd src/test/pipeline
        node run_namespace_cache_tests.js --mgmt_ip <mgmt_ip> --mgmt_port_https 8443 --s3_ip localhost --s3_port 6001 --skip_clean_con
