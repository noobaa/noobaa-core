# This Dockerfile contains the image specification of our database
FROM postgres:15

ARG HOST=localhost
COPY ./certs/ca.crt  /etc/ssl/certs/ca.crt
COPY ./certs/ca.key  /etc/ssl/certs/ca.key
COPY ./src/deploy/NVA_build/ssl_conf.sh /docker-entrypoint-initdb.d/ssl_conf.sh

RUN openssl genrsa -out /etc/ssl/private/server.key 2048
RUN openssl req -new -sha256 -key /etc/ssl/private/server.key -out /etc/ssl/private/server.csr -subj "/CN=${HOST}"
RUN openssl x509 -req -in /etc/ssl/private/server.csr -CA /etc/ssl/certs/ca.crt -CAkey  /etc/ssl/certs/ca.key -CAcreateserial -out /etc/ssl/private/server.crt -days 365 -sha256

RUN chmod 640 /etc/ssl/private/server.key
RUN chown root:ssl-cert /etc/ssl/private/server.key

ENTRYPOINT ["docker-entrypoint.sh"] 

CMD [ "-c", "ssl=on" , "-c", "ssl_cert_file=/etc/ssl/private/server.crt", "-c",\
    "ssl_key_file=/etc/ssl/private/server.key", "-c", \
    "ssl_ca_file=/etc/ssl/certs/ca.crt"]
