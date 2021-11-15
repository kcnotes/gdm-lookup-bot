// API calls and bulk API functions

const fetch = require('node-fetch');
const config = require('./config.json');

const FANDOM_ACCESS_TOKEN = config.fandom.accessToken;
const SERVICES_DLOG = config.fandom.serviceEndpoint;

const isIPv4Address = (address) => {
  if (typeof address !== 'string') {
    return false;
  }

  let RE_IP_BYTE = '(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|0?[0-9]?[0-9])',
    RE_IP_ADD = '(?:' + RE_IP_BYTE + '\\.){3}' + RE_IP_BYTE;

  return address.search(new RegExp('^' + RE_IP_ADD + '$')) !== -1;
};

const isIPv6Address = (address) => {
  if (typeof address !== 'string') {
    return false;
  }

  let RE_IPV6_ADD =
    '(?:' + // starts with "::" (including "::")
    ':(?::|(?::' + '[0-9A-Fa-f]{1,4}' + '){1,7})' +
    '|' + // ends with "::" (except "::")
    '[0-9A-Fa-f]{1,4}' + '(?::' + '[0-9A-Fa-f]{1,4}' + '){0,6}::' +
    '|' + // contains no "::"
    '[0-9A-Fa-f]{1,4}' + '(?::' + '[0-9A-Fa-f]{1,4}' + '){7}' +
    ')';

  if (address.search(new RegExp('^' + RE_IPV6_ADD + '$')) !== -1) {
    return true;
  }

  RE_IPV6_ADD = // contains one "::" in the middle (single '::' check below)
    '[0-9A-Fa-f]{1,4}' + '(?:::?' + '[0-9A-Fa-f]{1,4}' + '){1,6}';

  return address.search(new RegExp('^' + RE_IPV6_ADD + '$')) !== -1 &&
    address.search(/::/) !== -1 && address.search(/::.*::/) === -1;
};

const isIP = (user) => isIPv4Address(user) || isIPv6Address(user);

const dlog = async (user, tsFrom) => {
  const params = isIP(user) ? { ip: user } : { username: user };
  if (tsFrom) {
    params.ts_from = tsFrom;
  }

  const res = await fetch(`${SERVICES_DLOG}?${new URLSearchParams(params).toString()}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'cookie': `access_token=${FANDOM_ACCESS_TOKEN}`,
    },
  }).then(res => res.text());

  try {
    return JSON.parse(res);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(res);
    return {
      error: res || 'Error: Invalid username or connection issue with Fandom',
    };
  }
};

/**
 * @param {*} user User or IP
 * @param {*} tsFrom timestamp to start from
 * @param {*} midCallback Callback to be called in the middle of a fetch, if lots of results
 * @param {*} fireMidCallbackCount Number of API calls before firing the midCallback
 * @returns Array of logs
 */
const bulkDLog = async (user, tsFrom, midCallback, fireMidCallbackCount) => {
  if (fireMidCallbackCount === 0) {
    midCallback && midCallback();
  }
  const res = await dlog(user, tsFrom);
  if (res.error) {
    return res;
  }
  if (Array.isArray(res) && res.length !== 0) {
    const tsFrom = res[res.length - 1].timestamp.replace('T', ' ').replace('Z', '');
    const bulk = await bulkDLog(user, tsFrom, midCallback, fireMidCallbackCount - 1);
    return [...res, ...bulk];
  }
  return res;
};

module.exports = {
  dlog,
  bulkDLog,
  isIP,
};
