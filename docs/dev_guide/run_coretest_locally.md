# Run Tests From coretest Locally

## Run a Single Test

If you have a single coretest that you want to run, for example: `src/test/unit_tests/test_s3_bucket_policy.js`.
The options for running it are: NC deployment (no DB) and containerized deployment (with DB)

### A) NC deployment (No DB)
Run simply with `sudo NC_CORETEST=true node ./node_modules/mocha/bin/mocha .src/test/unit_tests/test_s3_bucket_policy.js`  
More info can be found in [CI & Tests](#ci--tests).

### B) Containerized deployment (With DB)
One way is to run it with: `make run-single-test testname=test_s3_bucket_policy.js`  
but it would take time to build the needed images, therefore we will focus on another way.

Another way is to create a postgres container and then run the test with the following steps:

#### First Tab - Run the Container
1. Pull postgres image version 15:  
`docker pull quay.io/sclorg/postgresql-15-c9s`
- We use postgres with version 15.
- `c9s` is for CentOS Stream 9.
2. Run the postgres container with this image:  
`docker run -p 5432:5432 -e POSTGRESQL_ADMIN_PASSWORD=noobaa  quay.io/sclorg/postgresql-15-c9s`
- Port 5432 is the port for docker.
- We added the env `POSTGRESQL_ADMIN_PASSWORD=noobaa` to match the default password, you can find in postgres client ([reference](https://github.com/noobaa/noobaa-core/blob/12847927fc3cde52c4ab0098da41de3ced1fc63a/src/util/postgres_client.js#L1480)).

expect to see output that starts with:
```
The files belonging to this database system will be owned by user "postgres".
This user must also own the server process.
```
and ends with:
```
Starting server...
2025-03-05 13:43:57.600 UTC [1] LOG:  redirecting log output to logging collector process
2025-03-05 13:43:57.600 UTC [1] HINT:  Future log output will appear in directory "log"
```

### Second Tab - Run the Test
3. Run the test:  
- If you run on Rancher Desktop:  
3.1. Run with: `./node_modules/mocha/bin/mocha.js src/test/unit_tests/test_s3_bucket_policy.js`  
(by default it is connected to 127.0.0.1).
- If you run on minikube:  
3.1. Take the address to connect to docker inside minikube: `minikube ip`  
3.2. Run with:  
`POSTGRES_HOST=<output of minikube ip> ./node_modules/mocha/bin/mocha.js src/test/unit_tests/test_s3_bucket_policy.js`

If you want to rerun the test after code changes you can easily run `ctrl + c` in the first tab (to stop and remove the container) and then run it again.  
Another option, which is less recommended, is to connect to postgres container and drop the tables with:
- If you run on Rancher Desktop:  
`psql -h 127.0.0.1 -p 5432 -U postgres postgres`
- If you run on minikube:  
`psql -h <output of minikube ip> -p 5432 -U postgres postgres`  
- And Then: `DROP DATABASE coretest;`

Notes:
* For running `psql` commands you would need to install it on your machine (better with the matching version of postgres).
* In case you already run postgres on your machine (not the mentioned container) it might raise some issues, better remove it (in MacOs using the Activity Monitor and search for postgres).
Example: you stopped the docker run, and you tried to connect to postgres, but got an error (probably password authentication failed). As it expected to see the following message when we don't have a postgres container:

```
psql: error: connection to server at "127.0.0.1", port 5432 failed: Connection refused
	Is the server running on that host and accepting TCP/IP connections?
```

* In case a test failed with "error: database "coretest" already exists" it means that you probably forgot to drop the DB table, and you can stop (ctrl + c) and rerun the `docker run` command mentioned above and then run the test again.
* If you want to run the test with higher debug level you can add the `NOOBAA_LOG_LEVEL=all`, for example: `NOOBAA_LOG_LEVEL=all ./node_modules/mocha/bin/mocha.js src/test/unit_tests/test_s3_bucket_policy.js` (notice that you can printings that are not only from `LOG`, `L0`, `WARN` and `ERROR`, for example: `L1`, `L2`, `L3`, etc.)

## Run All Tests

If you want to run all the mocha tests using the DB on the second tab you can simply run `npm test`.
