
# User Database support (LDAP) - POC


## Goal

We propose adding support for administrators who maintain an existing LDAP-compatible user directory, enabling them to reuse their current username and password credentials to obtain temporary access tokens for S3 operations.
This feature will leverage the AWS STS operation AssumeRoleWithWebIdentity. In the proposed workflow:
1. The client sends a signed(with a predfined constant signature) or unsigned JWT as the web identity token.
2. The system parses the JWT to extract the LDAP username and password.
3. These credentials are validated against a configured external LDAP server.
4. Upon successful authentication, the system issues a temporary STS token, granting the user access to S3 resources for a limited duration.

This approach ensures secure integration with existing identity infrastructures while eliminating the need to store or manage separate S3 credentials for LDAP users.

## Configuring the external LDAP
The administrator must store the LDAP configuration in the following file:
/etc/noobaa-server/ldap_config

The configuration should include:

uri (Required) – The FQDN of the external LDAP server, in the format:
ldaps://[server-ip-or-hostname]:[port] (e.g., port 636 for LDAPS)

admin (Required) – An administrator username with permission to execute search queries on the LDAP server.

secret (Required) – The password for the administrator account.

search_dn (Required) – The distinguished name (DN) under which search queries will be performed.

dn_attribute (Optional) – The DN attribute to be used in search queries (default: uid).

search_scope (Optional) – Determines how deep the LDAP search should go from the search_dn (default: sub):

* base – Search only the entry specified by search_dn.

* one – Search immediate children of search_dn, but not deeper levels.

* sub – Search the base DN and all its descendants recursively.

jwt_secret (Optional) - The JWT secret the administrator will use to sign the token sent in AssumeRoleWithWebIdentity requests (default: unsigned). Once this option is set - unsigned tokens or tokens signed with different secret will be dropped as access denied.

for example:
```json
{
  "uri": "ldap://ldap.example.com:636",
  "admin": "cn=admin,dc=example,dc=com",
  "secret": "SuperSecurePassword123",
  "search_dn": "ou=users,dc=example,dc=com",
  "dn_attribute": "uid",
  "search_scope": "sub",
  "jwt_secret": "IAMTHEADMIN123!(SHOULDBE256BITS)"
}
```

## Sending an AssumeRoleWithWebIdentity request
First create the json to be decoded:
```json
{
 "user": "TheUserName",
 "password": "TheUserPassword",
 "type": "ldap"
}
```
Sign it
node.js example:
```js
const jwt = require('jsonwebtoken');
console.log(jwt.sign({ user: "TheUserName", password: "TheUserPassword", type: "ldap" }, "IAMTHEADMIN123!(SHOULDBE256BITS)"));
eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyIjoiVGhlVXNlck5hbWUiLCJwYXNzd29yZCI6IlRoZVVzZXJQYXNzd29yZCIsInR5cGUiOiJsZGFwIiwiaWF0IjoxNzU1MTgxOTE3fQ.
```
Or you can use 'none' algorithm if you are not interested with verifying the token
```js
const jwt = require('jsonwebtoken');
console.log(jwt.sign({ user: "TheUserName", password: "TheUserPassword", type: "ldap" }, undefined, { algorithm: 'none' }));
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjoiVGhlVXNlck5hbWUiLCJwYXNzd29yZCI6IlRoZVVzZXJQYXNzd29yZCIsInR5cGUiOiJsZGFwIiwiaWF0IjoxNzU1MTgyMzQ2fQ.P6WYcdM0kJagNK4D0M8AHiGFcUZ-DhTOKHlC1-AxcT0
```
Now use this token with AWS STS AssumeRoleWithWebIdentity:
```bash
aws sts assume-role-with-web-identity --endpoint [endpoint] --role-arn [role-arn] --role-session-name [session-name] --web-identity-token eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyIjoiVGhlVXNlck5hbWUiLCJwYXNzd29yZCI6IlRoZVVzZXJQYXNzd29yZCIsInR5cGUiOiJsZGFwIiwiaWF0IjoxNzU1MTgxOTE3fQ.
```
role-name - ARN of the role that the caller is assuming. Make sure you created this role in advance using account-api or noobaa-cli (See Appendix. A). Format is: `arn:aws:sts::[user-access-key]:role/[role-name]`

user-access-key - the access key of the account (temp secret key and token will be returned by the call)

session-name - An identifier for the assumed role session. Typically, you pass the name or identifier that is associated with the user who is using your application.

Output: The temporary security credentials, which include an access key ID, a secret access key, and a security token.

read more here: https://docs.aws.amazon.com/cli/latest/reference/sts/assume-role-with-web-identity.html

## Next steps

1. See if we can move to using C open-ldap client as part of our native code instead of ldapts (for better performance and fewer security issues). see here: https://www.openldap.org/software/repo.html (We will mainly need bind and search)
2. Add a system test that will create an external ldap and will check the full authentication flow. You can base on dockers I used for testing:
* AD image: `docker run --rm --privileged -p 636:636 quay.io/samba.org/samba-ad-server:latest` (https://github.com/samba-in-kubernetes/samba-container)
* LDAP image: `docker run --rm --privileged -p 636:636 ghcr.io/ldapjs/docker-test-openldap/openldap:latest` (https://github.com/ldapjs/docker-test-openldap/pkgs/container/docker-test-openldap%2Fopenldap)
3. Add support to the operator side: 
* CLI command for configuring external LDAP
* Create K8s Secret for LDAP info and mount to /etc/noobaa-server/ldap_config to the relevant pods
4. Better align and adapt to the IAM effort also in POC stage
5. See if we want to support encrypted password as part of the JWT token. see here: https://auth0.com/docs/secure/tokens/access-tokens/json-web-encryption
6. We should maybe move ldap authentication to the authentication scope if possible

## Appendix A: Creating account w/ role config using NooBaa API:
```bash
curl http://127.0.0.1:5001/rpc/ -sd '{
    "api": "account_api",
    "method": "create_account",
    "params": {
        "name": "ldap", 
        "email": "ldap", 
        "has_login": false, 
        "s3_access": true, 
        "role_config": 
        { 
            "role_name": "ldap_user", 
            "assume_role_policy": 
            { 
                "statement": [ 
                { 
                    "effect": "allow", 
                    "action": ["sts:*"], 
                    "principal": ["*"] 
                }]
            }
        }
    },
    "auth_token": "'$(cat .nbtoken)'"
}'
```
in order to assume this role:
```bash
aws sts assume-role-with-web-identity --endpoint https://127.0.0.1:7443 --role-arn arn:aws:sts::pQII1cm5kFmpwqP6bzJh:role/ldap_user --role-session-name fry1 --web-identity-token eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyIjoiZnJ5IiwicGFzc3dvcmQiOiJmcnkiLCJ0eXBlIjoibGRhcCIsImlhdCI6MTc1NTQzMzkxOX0. --no-verify-ssl
{
    "Credentials": {
        "AccessKeyId": "<redacted-access-key>",
        "SecretAccessKey": "<redacted-secret-key>",
        "SessionToken": "<redacted-token>",
        "Expiration": "2025-08-17T14:03:18+00:00"
    },
    "AssumedRoleUser": {
        "AssumedRoleId": "pQII1cm5kFmpwqP6bzJh:fry1",
        "Arn": "arn:aws:sts::pQII1cm5kFmpwqP6bzJh:assumed-role/ldap_user/fry1"
    },
    "SourceIdentity": "cn=Philip J. Fry,ou=people,dc=planetexpress,dc=com"
}
```

