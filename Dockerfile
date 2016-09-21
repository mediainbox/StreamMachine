FROM cdgraff/ffmpeg

RUN rm /etc/localtime \
&& ln -s /usr/share/zoneinfo/Etc/UTC /etc/localtime

RUN DEBIAN_FRONTEND=noninteractive apt-get update -y \
&& DEBIAN_FRONTEND=noninteractive apt-get install -y curl software-properties-common

RUN DEBIAN_FRONTEND=noninteractive add-apt-repository -y ppa:andrewrk/libgroove \
&& DEBIAN_FRONTEND=noninteractive apt-get update -y \
&& DEBIAN_FRONTEND=noninteractive apt-get install -y libgroove-dev

RUN DEBIAN_FRONTEND=noninteractive curl -sL https://deb.nodesource.com/setup_4.x | sudo -E bash - \
&& DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs

RUN DEBIAN_FRONTEND=noninteractive apt-get clean \
&& rm -rf /var/lib/apt/lists/*

WORKDIR /data

EXPOSE 9002

CMD npm start
