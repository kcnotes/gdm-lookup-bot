require('dotenv').config();
const Discord = require('discord.js');
const nodeFetch = require('node-fetch');
const fetch = require('fetch-cookie')(nodeFetch);

const BOT_TOKEN = process.env.BOT_TOKEN,
      USERNAME = process.env.FANDOM_USERNAME,
      PASSWORD = process.env.FANDOM_PASSWORD,
      SERVICES_DLOG = 'https://services.fandom.com/global-discussion-log/logs',
      SERVICES_LOGIN = 'https://services.fandom.com/auth/token',
      client = new Discord.Client();

client.login(BOT_TOKEN);
login(); // Log in to Fandom

client.once('ready', () => {
    console.log(`Logged in to Discord.`);
});

const actions = {
    '!wikis': wikis,
    '!lookup': wikis,
    '!check': check,
    '!ping': pong,
    '!gdmhelp': help
};

const util = {
    isIPv4Address: function (address) {
        if (typeof address !== 'string') {
            return false;
        }

        let RE_IP_BYTE = '(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|0?[0-9]?[0-9])',
            RE_IP_ADD = '(?:' + RE_IP_BYTE + '\\.){3}' + RE_IP_BYTE;

        return address.search(new RegExp('^' + RE_IP_ADD + '$')) !== -1;
    }, 
    isIPv6Address: function (address) {
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
    }
};

async function login() {
    const params = new URLSearchParams();
    params.append('username', USERNAME);
    params.append('password', PASSWORD);
    let response = fetch(SERVICES_LOGIN, {
        method: 'post',
        body: params
    })
    .then(res => res.json())
    .then(json => {
        console.log('Logged in to Fandom.');
    });
}

function cleanUser(user) {
    // Trim whitespaces and new lines
    user = user.replace(/^[\s\n]+|[\s\n]+$/g, '');
    user = user.replace(/^<|>$/g, '');
    // Clean up links
    user = user.replace(/^https?:\/\//g, '');
    user = user.replace(/^.*\.(wikia|fandom|gamepedia)\.(com|org|io)\/(wiki\/)?/g, '');
    user = user.replace(/^(User:|Special:Contributions\/|Special:Contribs\/)/g, '');
    // Replace spaces
    user = user.replace(/(%20|_)/g, ' ');
    // Uppercase first letter of the username
    user = user.charAt(0).toUpperCase() + user.slice(1);
    return user;
}

async function dlog(username, ts_from) {
    let data = {};
    let isIP = util.isIPv4Address(username) || util.isIPv6Address(username);
    if (isIP) {
        data.ip = username;
    } else {
        data.username = username;
    }
    if (ts_from) {
        data.ts_from = ts_from;
    }
    // Get the data
    const params = new URLSearchParams(data);
    let response = await fetch(SERVICES_DLOG + '?' + params, {
        method: 'GET',
        credentials: 'include',
        headers: {'Content-Type': 'application/json'}
    });
    // Filter out, see UserUtil
    const resp = await response.text();
    try {
        var respJson = JSON.parse(resp);
    } catch (e) {
        console.log(resp);
        return {
            error: 'Error: invalid username, or connection issue with Fandom'
        };
    }
    const filterByType = isIP ? 'ip' : 'userName';
    const filtering = isIP ? 'userName' : 'ip';
    let flags = {};
    let filteredData = respJson.filter(log => {
        if (flags[log.siteName] && flags[log.siteName][log[filterByType]] === log[filtering]) {
            return false;
        }
        flags[log.siteName] = {};
        flags[log.siteName][log[filterByType]] = log[filtering];
        return true;
    });
    return {
        logs: filteredData,
        count: respJson.length,
                ts_from: respJson.length === 100 ? respJson[respJson.length - 1].timestamp.replace('T', ' ').replace('Z', '') : null
    };
}

function filterByWiki(logs) {
    let flags = {};
    return logs.filter(log => {
        if (flags[log.siteName]) {
            return false;
        }
        flags[log.siteName] = true;
        return true;
    });
}

function filterByUsername(logs, originalUsername) {
    let flags = {};
    flags[originalUsername] = true;
    return logs.filter(log => {
        if (flags[log.userName]) {
            return false;
        }
        flags[log.userName] = true;
        return true;
    });
}

function filterByIP(logs) {
    let flags = {};
    return logs.filter(log => {
        if (flags[log.ip]) {
            return false;
        }
        flags[log.ip] = true;
        return true;
    });
}

function filterByWikiAndIP(logs, wiki) {
    let flags = {};
    return logs.filter(log => {
        if (wiki && log.siteName !== wiki) return false;
        if (flags[log.ip]) {
            return false;
        }
        flags[log.ip] = true;
        return true;
    });
}

function filterByUsernameAndWiki(logs, originalUsername, wiki) {
    let flags = {};
    flags[originalUsername] = true;
    return logs.filter(log => {
        if (wiki && log.siteName !== wiki) return false;
        if (flags[log.userName]) {
            return false;
        }
        flags[log.userName] = true;
        return true;
    });
}

async function wikis(msg) {
    let parts = msg.content.split(' ');
    parts.shift();
    let username = parts.join(' ');
    username = cleanUser(username);
    let isIP = util.isIPv4Address(username) || util.isIPv6Address(username);
    if (isIP) {
        msg.channel.send('Cannot lookup the wikis for an IP.');
        return;
    }
    
    // Load a limited set of activity
    let ts_from = '',
        logsToLoad = 10,
        logs = [];
    while (ts_from != null && logsToLoad > 0) {
        if (logsToLoad === 9) {
            // Send an intermediate 'Loading'
            msg.channel.send('Loading logs... please wait! User has lots of activity!');
        }
        let data = await dlog(username, ts_from);
        if (data && data.error) {
            msg.channel.send(data.error);
            return;
        }
        logs = logs.concat(filterByWiki(data.logs));
        ts_from = data.ts_from;
        logsToLoad--;
    }
    logs = filterByWiki(logs);

    let wikis = [];
    logs.forEach(log => {
        if (log.siteName !== '') {
            wikis.push('• <https://' + log.siteName + '/f/u/' + log.userId + '>');
        }
    });
    if (logs.length === 0 || wikis.length === 0) {
        msg.channel.send('No wikis found for ' + username + '.');
    }
    else if (logsToLoad === 0) {
        msg.channel.send(wikis.join('\n') + '\n(Data from the latest 1000 actions, since ' + ts_from.replace(/ .*/g, '') + ')', {split: true});
    } else {
        msg.channel.send(wikis.join('\n'), {split: true});
    }
}

async function check(msg, wiki) {
    let parts = msg.content.split(' ');
    parts.shift();
    let username = parts.join(' ');
    username = cleanUser(username);
    let isIP = util.isIPv4Address(username) || util.isIPv6Address(username);

    // Allow IP checks only for single wikis
    if (isIP && !wiki) {
        msg.channel.send('IP check is not supported yet.');
    } else if (isIP) {
        msg.channel.send('Cannot check an IP.');
        return;
    }

    let userData = await dlog(username);
    if (userData && userData.error) {
        msg.channel.send(userData.error);
        return;
    }

    // Filter by IP (and per wiki, if required)
    let ipLogs;
    if (wiki) {
        ipLogs = filterByWikiAndIP(userData.logs, wiki);
    } else {
        ipLogs = filterByIP(userData.logs);
    }

    let promises = [];
    let userIpAgents = [];
    let userIpAppIds = [];
    for (const log of ipLogs) {
        userIpAgents.push(log.userAgent);
        if (log.appId !== '' && log.appId !== 'opted-out') {
            userIpAppIds.push(log.appId);
        }
        promises.push(dlog(log.ip));
    }
    var userLogs = [];

    Promise.all(promises).then(([...alliplogs]) => {
        for (const iplog of alliplogs) {
            if (wiki) {
                userLogs = userLogs.concat(filterByUsernameAndWiki(iplog.logs, username, wiki));
            } else {
                userLogs = userLogs.concat(filterByUsername(iplog.logs, username));
            }
        }
        if (wiki) {
            userLogs = filterByUsernameAndWiki(userLogs, username, wiki);
        } else {
            userLogs = filterByUsername(userLogs, username);
        }

        let users = [];
        userLogs.forEach(log => {
            if (userIpAppIds.indexOf(log.appId) >= 0) {
                users.push('• ' + log.userName + ' <https://' + log.siteName + '/f/u/' + log.userId + '> :exclamation:`App ID match`');
            }
            else if (userIpAgents.indexOf(log.userAgent) >= 0) {
                users.push('• ' + log.userName + ' <https://' + log.siteName + '/f/u/' + log.userId + '> :exclamation:`device/browser match`');
            } else {
                users.push('• ' + log.userName + ' <https://' + log.siteName + '/f/u/' + log.userId + '>');
            }
        });
        if (users.length == 0) {
            msg.channel.send('No accounts found for ' + username + '.');
        } else {
            msg.channel.send(users.length + ' users found with the same IP/s as ' + username + '.\n' + users.join('\n'), {
                split: true
            });
        }
        
    });
}

function pong(msg) {
    msg.channel.send('Pong.');
}

function help(msg) {
    msg.channel.send(
           '`!wikis <user>`: Lists wikis where the user has Discussions posts, replies, upvotes, deletes, locks. \n' +
           '`!check <user>`: Lists alternate accounts (shares the same IPs) based on Discussions activity. \n' +
           '`!ping`: Check if this bot is alive. \n' + 
           '`!gdmhelp`: Shows this list of commands. \n' +
           'Work in progress: planning to reduce !wikis to just posts and replies.'
    );
}

client.on('message', message => {
    let allowedChannelIds = [
        '741183214386937926', // noreply
        '741224570987479060', // gdm
        '752725171269533829'  // xiphos
    ];
    let singleWikiAllowedChannelIds = [
        '766444966259851275'
    ];
    let singleWikiConfig = {
        '766444966259851275': {
            wiki: 'community.fandom.com'
        }
    };
    let singleWikiAllowedActions = ['!check', '!ping', '!gdmhelp'];

    if (allowedChannelIds.indexOf(message.channel.id) >= 0) {
        for (const action in actions) {
            if (message.content.startsWith(action)) {
                actions[action](message);
            }
        }
    }
    if (singleWikiAllowedChannelIds.indexOf(message.channel.id) >= 0) {
        for (const action in actions) {
            if (singleWikiAllowedActions.includes(action)) {
                if (message.content.startsWith(action)) {
                    actions[action](message, singleWikiConfig[message.channel.id].wiki);
                }
            }
        }
    }
    // talesofarcadia q-and-a && Aaron
    if (message.channel.id === '744708572125855785' && message.author.id === '248690852606640128') {
        // q-and-a-library
        const channel = client.channels.cache.get('745636562921979955');
        let msg = message.content.toString();
        msg = msg.replace(/<@!?\d+?>/g, '');
        channel.send(msg + ' (<https://discordapp.com/channels/739438769677139989/744708572125855785/' + message.id + '>)');
    }
});