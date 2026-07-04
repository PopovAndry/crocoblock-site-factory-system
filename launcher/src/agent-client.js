"use strict";

const http = require("http");

function requestJson(targetUrl, options) {
  return new Promise((resolve, reject) => {
    const request = http.request(targetUrl, {
      method: options && options.method ? options.method : "GET",
      headers: options && options.headers ? options.headers : {}
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        let parsed = null;

        try {
          parsed = body ? JSON.parse(body) : null;
        } catch (error) {
          parsed = null;
        }

        resolve({
          statusCode: response.statusCode || 0,
          body,
          json: parsed,
          headers: response.headers
        });
      });
    });

    request.setTimeout(options && options.timeoutMs ? options.timeoutMs : 10000, () => {
      request.destroy(new Error("HTTP request timed out: " + targetUrl));
    });

    request.on("error", reject);
    if (options && options.body) {
      request.write(options.body);
    }
    request.end();
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUrl(targetUrl, options) {
  const timeoutMs = options && options.timeoutMs ? options.timeoutMs : 120000;
  const intervalMs = options && options.intervalMs ? options.intervalMs : 3000;
  const deadline = Date.now() + timeoutMs;
  let lastError = "HTTP readiness check did not start.";

  while (Date.now() < deadline) {
    try {
      const response = await requestJson(targetUrl);
      if (response.statusCode >= 200 && response.statusCode < 500) {
        return response;
      }
      lastError = "HTTP " + String(response.statusCode) + " from " + targetUrl;
    } catch (error) {
      lastError = error.message;
    }

    await delay(intervalMs);
  }

  throw new Error("Timed out waiting for " + targetUrl + ". Last error: " + lastError);
}

function createBasicAuthHeader(username, password) {
  return "Basic " + Buffer.from(String(username) + ":" + String(password), "utf8").toString("base64");
}

async function fetchJsonWithBasicAuth(targetUrl, username, password, options) {
  const headers = Object.assign({}, options && options.headers ? options.headers : {}, {
    Authorization: createBasicAuthHeader(username, password)
  });
  const response = await requestJson(targetUrl, Object.assign({}, options || {}, { headers }));

  if ((response.statusCode < 200 || response.statusCode >= 300) || !response.json) {
    throw new Error("Agent endpoint request failed: " + targetUrl + " (HTTP " + String(response.statusCode) + ")");
  }

  return response;
}

async function fetchJsonWithCookie(targetUrl, cookieHeader, restNonce, options) {
  const headers = Object.assign({}, options && options.headers ? options.headers : {}, {
    Cookie: cookieHeader,
    "X-WP-Nonce": restNonce
  });
  const response = await requestJson(targetUrl, Object.assign({}, options || {}, { headers }));

  if ((response.statusCode < 200 || response.statusCode >= 300) || !response.json) {
    throw new Error("Agent endpoint request failed: " + targetUrl + " (HTTP " + String(response.statusCode) + ")");
  }

  return response;
}

module.exports = {
  createBasicAuthHeader,
  fetchJsonWithBasicAuth,
  fetchJsonWithCookie,
  requestJson,
  waitForUrl
};
