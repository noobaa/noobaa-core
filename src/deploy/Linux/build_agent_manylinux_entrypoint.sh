#!/bin/bash

# If we are running docker natively, we want to create a user in the container
# with the same UID and GID as the user on the host machine, so that any files
# created are owned by that user. Without this they are all owned by root.

SCRIPT="/tmp/build_agent_manylinux_args.sh"
echo "Entrypoint Args ($SCRIPT): $@"
echo "$@" > $SCRIPT
chmod +x $SCRIPT

if [[ -n $BUILDER_UID ]] && [[ -n $BUILDER_GID ]]
then
    echo "Creating user $BUILDER_USER($BUILDER_UID):$BUILDER_GROUP($BUILDER_GID)"
    groupadd -o -g $BUILDER_GID $BUILDER_GROUP
    useradd -o -m -g $BUILDER_GID -u $BUILDER_UID $BUILDER_USER
    export HOME=/home/${BUILDER_USER}
    shopt -s dotglob
    cp -r /root/* $HOME/
    chown -R $BUILDER_UID:$BUILDER_GID $HOME
    su $BUILDER_USER -c "scl enable devtoolset-7 $SCRIPT"
else
    scl enable devtoolset-7 $SCRIPT
fi
