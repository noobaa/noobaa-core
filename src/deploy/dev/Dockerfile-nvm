FROM ubuntu

# replace default linux shell with bash
RUN mv /bin/sh /bin/sh.original && ln -s /bin/bash /bin/sh

# update ubuntu, and add packages
RUN apt-key update
RUN apt-get -y update
RUN apt-get -y install curl python git build-essential

# install NVM
RUN curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.31.0/install.sh | \
    NVM_DIR='/nvm' PROFILE='/etc/profile' bash

ARG NODE_VERSION 4
RUN . /nvm/nvm.sh && \
    nvm install ${NODE_VERSION} && \
    nvm alias default ${NODE_VERSION} && \
    nvm use default

#ARG USER_NAME noobaa
#RUN useradd -ms /bin/bash ${USER_NAME}
#USER ${USER_NAME}
#WORKDIR /home/${USER_NAME}

CMD bash
