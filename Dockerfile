FROM mediainbox/base

# Maintener
MAINTAINER Alejandro Ferrari <aferrari@mediainbox.net>

# Change localtime
RUN rm /etc/localtime && ln -s /usr/share/zoneinfo/Etc/UTC /etc/localtime

RUN apk add --update \
    python \
    python-dev \
    py-pip \
    py-setuptools \
    build-base \
    tar \
    bzip2 \
    nasm \
    git \
    bash
RUN pip install j2cli

WORKDIR /srv
RUN git clone https://github.com/mediainbox/StreamMachine.git
RUN cd StreamMachine && npm install
