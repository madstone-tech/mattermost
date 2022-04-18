FROM public.ecr.aws/amazonlinux/amazonlinux:latest

# Some ENV variables
ENV PATH="/mattermost/bin:${PATH}"
ENV MM_INSTALL_TYPE=docker


# amazonlinux dependencies
RUN yum update -y && \
	amazon-linux-extras install epel -y && \
	yum clean all;rm -rf /var/cache/yum && \
	yum -y install openssl which expect tar openssh-clients \
	ca-certificates \
	curl \
	jq \
	libc6-compat \
	libffi-dev \
	libcap \
	linux-headers \
	mailcap \
	netcat-openbsd \	
	xmlsec-dev \
	tzdata \
	tar && \
	yum clean all && rm -rf /var/cache/yum 


# Build argument to set Mattermost edition
ARG edition=enterprise
ARG PUID=2000
ARG PGID=2000
ARG MM_BINARY=
ARG MM_VERSION=6.6.0

# Get Mattermost

RUN mkdir -p /mattermost/data /mattermost/plugins /mattermost/client/plugins \
	&& if [ ! -z "$MM_BINARY" ]; then curl $MM_BINARY | tar -xvz ; \
	elif [ "$edition" = "team" ] ; then curl https://releases.mattermost.com/$MM_VERSION/mattermost-team-$MM_VERSION-linux-amd64.tar.gz?src=docker-app | tar -xvz ; \
	else curl https://releases.mattermost.com/$MM_VERSION/mattermost-$MM_VERSION-linux-amd64.tar.gz?src=docker-app | tar -xvz ; fi \
	&& cp /mattermost/config/config.json /config.json.save \
	&& rm -rf /mattermost/config/config.json \
	&& groupadd -g ${PGID} mattermost \
	&& useradd -u ${PUID} -g ${PGID} mattermost -d /mattermost \
	&& chown -R mattermost:mattermost /mattermost /config.json.save /mattermost/plugins /mattermost/client/plugins
USER mattermost

WORKDIR /mattermost


#RUN useradd --system --user-group mattermost
#RUN chown -R mattermost:mattermost /mattermost
#RUN chmod -R g+w /mattermost 

USER mattermost

#Healthcheck to make sure container is ready
HEALTHCHECK CMD curl --fail http://localhost:8000 || exit 1

# Configure entrypoint and command
COPY entrypoint.sh /
ENTRYPOINT ["/entrypoint.sh"]
WORKDIR /mattermost
CMD ["mattermost"]

# Expose port 8000 of the container
EXPOSE 8000

# Declare volumes for mount point directories
VOLUME ["/mattermost/data", "/mattermost/logs", "/mattermost/config", "/mattermost/plugins", "/mattermost/client/plugins"]
