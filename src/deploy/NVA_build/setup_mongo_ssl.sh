MONGO_SSL_PATH="/data/mongo/ssl/"

# taken from https://www.mongodb.com/blog/post/secure-mongodb-with-x-509-authentication

# Changing this to include: country, province, city, company
dn_prefix="/C=US/ST=NY/L=NYC/O=NOOBAA"
ou_member="MyServers"
ou_client="MyClients"
mongodb_server_hosts=( "server" )
mongodb_client_hosts=( "client" )

echo "##### creating ssl certificates for mongo authentication "
echo "##### STEP 1: Generate root CA "
openssl genrsa -out ${MONGO_SSL_PATH}/root-ca.key 2048
# !!! In production you will want to use -aes256 to password protect the keys
# openssl genrsa -aes256 -out root-ca.key 2048

openssl req -new -x509 -days 7300 -key ${MONGO_SSL_PATH}/root-ca.key -out ${MONGO_SSL_PATH}/root-ca.crt -subj "$dn_prefix/CN=ROOTCA"

mkdir -p ${MONGO_SSL_PATH}/RootCA/ca.db.certs
echo "01" >> ${MONGO_SSL_PATH}/RootCA/ca.db.serial
touch ${MONGO_SSL_PATH}/RootCA/ca.db.index
echo $RANDOM >> ${MONGO_SSL_PATH}/RootCA/ca.db.rand
mv ${MONGO_SSL_PATH}/root-ca* ${MONGO_SSL_PATH}/RootCA/

echo "##### STEP 2: Create CA config"
# Generate CA config
cat >> ${MONGO_SSL_PATH}/root-ca.cfg <<EOF
[ RootCA ]
dir             = ${MONGO_SSL_PATH}/RootCA
certs           = \$dir/ca.db.certs
database        = \$dir/ca.db.index
new_certs_dir   = \$dir/ca.db.certs
certificate     = \$dir/root-ca.crt
serial          = \$dir/ca.db.serial
private_key     = \$dir/root-ca.key
RANDFILE        = \$dir/ca.db.rand
default_md      = sha256
default_days    = 3650
default_crl_days= 3650
email_in_dn     = no
unique_subject  = no
policy          = policy_match

[ SigningCA ]
dir             = ${MONGO_SSL_PATH}/SigningCA
certs           = \$dir/ca.db.certs
database        = \$dir/ca.db.index
new_certs_dir   = \$dir/ca.db.certs
certificate     = \$dir/signing-ca.crt
serial          = \$dir/ca.db.serial
private_key     = \$dir/signing-ca.key
RANDFILE        = \$dir/ca.db.rand
default_md      = sha256
default_days    = 3650
default_crl_days= 3650
email_in_dn     = no
unique_subject  = no
policy          = policy_match
 
[ policy_match ]
countryName     = match
stateOrProvinceName = match
localityName            = match
organizationName    = match
organizationalUnitName  = optional
commonName      = supplied
emailAddress        = optional

[ v3_req ]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment

[ v3_ca ]
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid:always,issuer:always
basicConstraints = CA:true
EOF

echo "##### STEP 3: Generate signing key"
# We do not use root key to sign certificate, instead we generate a signing key
openssl genrsa -out ${MONGO_SSL_PATH}/signing-ca.key 2048
# !!! In production you will want to use -aes256 to password protect the keys
# openssl genrsa -aes256 -out signing-ca.key 2048

openssl req -new -days 7300 -key ${MONGO_SSL_PATH}/signing-ca.key -out ${MONGO_SSL_PATH}/signing-ca.csr -subj "$dn_prefix/CN=CA-SIGNER"
openssl ca -batch -name RootCA -startdate 201708010000Z -config ${MONGO_SSL_PATH}/root-ca.cfg -extensions v3_ca -out ${MONGO_SSL_PATH}/signing-ca.crt -infiles ${MONGO_SSL_PATH}/signing-ca.csr 

mkdir -p ${MONGO_SSL_PATH}/SigningCA/ca.db.certs
echo "01" >> ${MONGO_SSL_PATH}/SigningCA/ca.db.serial
touch ${MONGO_SSL_PATH}/SigningCA/ca.db.index
# Should use a better source of random here..
echo $RANDOM >> ${MONGO_SSL_PATH}/SigningCA/ca.db.rand
mv ${MONGO_SSL_PATH}/signing-ca* ${MONGO_SSL_PATH}/SigningCA/

# Create root-ca.pem
cat ${MONGO_SSL_PATH}/RootCA/root-ca.crt ${MONGO_SSL_PATH}/SigningCA/signing-ca.crt > ${MONGO_SSL_PATH}/root-ca.pem



echo "##### STEP 4: Create server certificates"
# Now create & sign keys for each mongod server 
# Pay attention to the OU part of the subject in "openssl req" command
# You may want to use FQDNs instead of short hostname
for host in "${mongodb_server_hosts[@]}"; do
	echo "Generating key for $host"
  	openssl genrsa  -out ${MONGO_SSL_PATH}/${host}.key 2048
	openssl req -new -days 7300 -key ${MONGO_SSL_PATH}/${host}.key -out ${MONGO_SSL_PATH}/${host}.csr -subj "$dn_prefix/OU=$ou_member/CN=${host}"
	openssl ca -batch -name SigningCA -startdate 201708010000Z -config ${MONGO_SSL_PATH}/root-ca.cfg -out ${MONGO_SSL_PATH}/${host}.crt -infiles ${MONGO_SSL_PATH}/${host}.csr
	cat ${MONGO_SSL_PATH}/${host}.crt ${MONGO_SSL_PATH}/${host}.key > ${MONGO_SSL_PATH}/${host}.pem	
done 

echo "##### STEP 5: Create client certificates"
# Now create & sign keys for each client
# Pay attention to the OU part of the subject in "openssl req" command
for host in "${mongodb_client_hosts[@]}"; do
	echo "Generating key for $host"
  	openssl genrsa  -out ${MONGO_SSL_PATH}/${host}.key 2048
	openssl req -new -days 7300 -key ${MONGO_SSL_PATH}/${host}.key -out ${MONGO_SSL_PATH}/${host}.csr -subj "$dn_prefix/OU=$ou_client/CN=${host}"
	openssl ca -batch -name SigningCA -startdate 201708010000Z -config ${MONGO_SSL_PATH}/root-ca.cfg -out ${MONGO_SSL_PATH}/${host}.crt -infiles ${MONGO_SSL_PATH}/${host}.csr
	cat ${MONGO_SSL_PATH}/${host}.crt ${MONGO_SSL_PATH}/${host}.key > ${MONGO_SSL_PATH}/${host}.pem
done 

