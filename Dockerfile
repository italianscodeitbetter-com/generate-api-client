FROM postgres:17.2

# Install additional tools if needed (pg_dump and pg_restore are already included)
RUN apt-get update && apt-get install -y \
    && rm -rf /var/lib/apt/lists/*

# Copy sync script
COPY sync.sh /usr/local/bin/sync.sh
RUN chmod +x /usr/local/bin/sync.sh

# Set working directory
WORKDIR /workspace

# Default command
CMD ["/usr/local/bin/sync.sh"]
