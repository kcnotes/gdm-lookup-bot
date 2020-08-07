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
    '!lookup': lookup,
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
    console.log(data);
    // Get the data
    const params = new URLSearchParams(data)
    let response = await fetch(SERVICES_DLOG + '?' + params, {
        method: 'GET',
        credentials: 'include',
        headers: {'Content-Type': 'application/json'}
    });
    // Filter out, see UserUtil
    const resp = await response.json();
    const filterByType = isIP ? 'ip' : 'userName';
    const filtering = isIP ? 'userName' : 'ip';
    let flags = {};
    let filteredData = resp.filter(log => {
        if (flags[log.siteName] && flags[log.siteName][log[filterByType]] === log[filtering]) {
            return false;
        }
        flags[log.siteName] = {};
        flags[log.siteName][log[filterByType]] = log[filtering];
        return true;
    });
    return {
        logs: filteredData,
        count: resp.length,
        ts_from: resp.length === 100 ? resp[resp.length-1].timestamp.replace('T', ' ').replace('Z', '') : null
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

async function lookup(msg) {
    let parts = msg.content.split(' ');
    parts.shift();
    let username = parts.join(' ');
    let isIP = util.isIPv4Address(username) || util.isIPv6Address(username);
    if (isIP) {
        msg.channel.send('Cannot lookup an IP.');
        return;
    }
    
    // Load a limited set of activity
    let ts_from = '',
        logsToLoad = 10,
        logs = [];
    while (ts_from != null && logsToLoad > 0) {
        let data = await dlog(username, ts_from);
        logs = logs.concat(filterByWiki(data.logs));
        ts_from = data.ts_from;
        logsToLoad--;
        console.log(data.ts_from);
    }
    logs = filterByWiki(logs);    

    let wikis = [];
    logs.forEach(log => {
        if (log.siteName !== '') {
            wikis.push(' • <https://' + log.siteName + '/f/u/' + log.userId + '>');
        }
    });
    if (logsToLoad === 0) {
        msg.channel.send(wikis.join('\n') + '\n(Data from the latest 1000 actions, since ' + ts_from.replace(/ .*/g, '') + ')', {split: true});
    } else {
        msg.channel.send(wikis.join('\n'), {split: true});
    }
}

async function check(msg) {
    let parts = msg.content.split(' ');
    parts.shift();
    let username = parts.join(' ');
    let isIP = util.isIPv4Address(username) || util.isIPv6Address(username);
    if (isIP) {
        msg.channel.send('Cannot check an IP.');
        return;
    }

    let userData = await dlog(username);
    let ipLogs = filterByIP(userData.logs);
    let promises = [];
    for (const log of ipLogs) {
        promises.push(dlog(log.ip));
    }
    var userLogs = [];
    Promise.all(promises).then(([...alliplogs]) => {
        for (const iplog of alliplogs) {
            userLogs = userLogs.concat(filterByUsername(iplog.logs, username));
        }
        userLogs = filterByUsername(userLogs, username);

        let users = [];
        userLogs.forEach(log => {
            users.push(' • ' + log.userName);
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
           '`!lookup <user>`: Lists wikis where the user has Discussions posts, replies, upvotes, deletes, locks. \n' +
           '`!check <user>`: Lists alternate accounts (shares the same IPs) based on Discussions activity. \n' +
           '`!ping`: Check if this bot is alive. \n' + 
           '`!gdmhelp`: Shows this list of commands. \n' +
           'Work in progress: planning to reduce !lookup to just posts and replies.'
    );
}

client.on('message', message => {
    for (const action in actions) {
        if (message.content.startsWith(action)) {
            actions[action](message);
        }
    }
});