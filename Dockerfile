# Use the official Apify Playwright Firefox image
FROM apify/actor-node-playwright-firefox:24-1.59.1

# Copy just package.json and package-lock.json first for caching
COPY --chown=myuser:myuser package*.json ./

# Install NPM packages (production only)
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && rm -r ~/.npm

# Copy remaining source code
COPY --chown=myuser:myuser . ./

# Start the actor
CMD npm start --silent
