# Jinja2 Template idea from: https://tryolabs.com/blog/2015/03/26/configurable-docker-containers-for-multiple-environments/

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
    bash \
    curl
RUN pip install --upgrade pip && pip install j2cli

WORKDIR /srv
RUN git clone https://github.com/mediainbox/StreamMachine.git
RUN cd StreamMachine && npm install
COPY master.json.j2 /config/
COPY docker-entrypoint.sh /

VOLUME "/config"

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["StreamMachine/streammachine-cmd", "--config", "/config/master.json"]
