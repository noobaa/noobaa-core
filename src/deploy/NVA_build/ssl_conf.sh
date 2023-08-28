#!/bin/bash
# echo ssl setting into pg_hba.conf configuration file
echo 'local all all trust' > /var/lib/postgresql/data/pg_hba.conf
echo 'hostssl all all all cert clientcert=verify-full' >> /var/lib/postgresql/data/pg_hba.conf
