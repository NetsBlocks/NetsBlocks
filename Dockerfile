from node:6.9.2
MAINTAINER Brian Broll <brian.broll@vanderbilt.edu>

ENV ENV production
ENV DEBUG netsblox*
ENV NETSBLOX_BLOB_DIR /blob-data

ADD . /netsblox
WORKDIR /netsblox
RUN rm -rf node_modules && npm install; \
    mkdir -p src/client/dist; \
    npm run postinstall

# TODO: install cairo graphics
EXPOSE 8080

CMD ["npm", "start"]
