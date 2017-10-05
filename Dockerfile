from node:6.9.2
MAINTAINER Brian Broll <brian.broll@vanderbilt.edu>

ENV ENV production
ENV DEBUG netsblox*
ENV NETSBLOX_BLOB_DIR /blob-data

RUN apt-get update && apt-get install build-essential libgd-dev libcairo2-dev libcairo2-dev libpango1.0-dev libgd2-dev -y

RUN echo compile and install gnuplot

RUN mkdir /tmp/gnuInstall -p && cd /tmp/gnuInstall && \
wget https://downloads.sourceforge.net/project/gnuplot/gnuplot/5.2.0/gnuplot-5.2.0.tar.gz && tar -xzvf gnuplot-5.2.0.tar.gz && \
cd gnuplot-5.2.0 && ./configure && make && make install && \
cd ../.. && rm -rf gnuInstall

RUN echo finished installing gnuplot

ADD . /netsblox
WORKDIR /netsblox
RUN rm -rf node_modules && npm install; \
    mkdir -p src/client/dist; \
    npm run postinstall

EXPOSE 8080

CMD ["npm", "start"]
