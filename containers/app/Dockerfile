FROM public.ecr.aws/amazonlinux/amazonlinux:2

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

# Setting bash as our shell, and enabling pipefail option


ENV PATH="/mattermost/bin:${PATH}"

# Build argument to set Mattermost edition
ARG edition=enterprise
ARG PUID=2000
ARG PGID=2000
ARG MM_BINARY=
ARG MM_VERSION=7.10.2
ARG MM_PACKAGE=https://releases.mattermost.com/${MM_VERSION}}/mattermost-${MM_VERSION}-linux-amd64.tar.gz?src=docker

# Get Mattermost

RUN mkdir -p /mattermost/data /mattermost/plugins /mattermost/client/plugins \
  && curl https://releases.mattermost.com/$MM_VERSION/mattermost-$MM_VERSION-linux-amd64.tar.gz?src=docker | tar -xvz \
  && cp /mattermost/config/config.json /config.json.save \
  && rm -rf /mattermost/config/config.json \
  && groupadd -g ${PGID} mattermost \
  && useradd -u ${PUID} -g ${PGID} mattermost -d /mattermost \
  && chown -R mattermost:mattermost /mattermost /config.json.save /mattermost/plugins /mattermost/client/plugins
USER mattermost

WORKDIR /mattermost

USER mattermost

#Healthcheck to make sure container is ready
HEALTHCHECK --interval=30s --timeout=10s CMD curl -f http://localhost:8065/api/v4/system/ping || exit 1

# Configure entrypoint and command
COPY entrypoint.sh /
ENTRYPOINT ["/entrypoint.sh"]
WORKDIR /mattermost
CMD ["mattermost"]

# Expose port 8000 of the container
EXPOSE 8000 8065 8067 8074 8075

# Declare volumes for mount point directories
VOLUME ["/mattermost/data", "/mattermost/logs", "/mattermost/config", "/mattermost/plugins", "/mattermost/client/plugins"]
