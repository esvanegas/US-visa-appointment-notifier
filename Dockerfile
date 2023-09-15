ARG BUILD_FROM
FROM $BUILD_FROM


RUN apk add --no-cache nodejs-current yarn chromium && \
	yarn global add npm

# Copy data for add-on
COPY . /
RUN yarn
COPY run.sh /
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]