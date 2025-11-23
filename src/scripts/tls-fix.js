require("global-agent/bootstrap");

global.GLOBAL_AGENT.HTTP_PROXY = process.env.HTTP_PROXY || undefined;
global.GLOBAL_AGENT.HTTPS_PROXY = process.env.HTTPS_PROXY || undefined;

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // allow TLS handshake
