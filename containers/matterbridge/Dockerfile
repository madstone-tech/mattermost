FROM amazonlinux:latest
LABEL version="1.22.1"
LABEL maintaner="Madstone Technology"
# amazonlinux dependencies
RUN yum update -y && \
	amazon-linux-extras install epel golang1.11 -y && \
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
ARG PUID=2000
ARG PGID=2000
ARG VERSION=1.22.1

# matterbridge user
RUN mkdir -p /matterbridge /matterbridge/config && \
	groupadd -g ${PGID} matterbridge && \
	useradd -u ${PUID} -g ${PGID} matterbridge -d /matterbridge 

# Get Matterbridge

ADD https://github.com/42wim/matterbridge/releases/download/v${VERSION}/matterbridge-${VERSION}-linux-64bit /matterbridge/matterbridge
RUN chmod +x /matterbridge/matterbridge && \
	chown -R matterbridge:matterbridge /matterbridge	

USER matterbridge
COPY matterbridge-sample.toml /matterbridge/config/matterbridge.toml

WORKDIR /matterbridge
CMD ["/matterbridge/matterbridge","-conf","/matterbridge/config/matterbridge.toml"]

# Declare volumes for mount point directories
VOLUME ["/matterbridge/config"]
